# Codia 权限系统 Plan

## 架构概览

在现有工具执行链中插入一个 PermissionChecker 模块，它封装五层决策逻辑。
检查点在 ToolScheduler 调用 executeTool 之前——每个 ToolCall 执行前先通过权限检查，拿到 allow/deny 结果后再决定是否执行。

### 新增组件

**PermissionChecker（权限检查器）**
五层决策链的编排器。接收 PermissionRequest，按 Layer 1→5 顺序调用各层，一层能判定就立即返回。

**Blocklist（危险命令黑名单）—— Layer 1**
内置正则列表，在 shell 命令执行前扫描命令字符串，命中即 deny。不可配置、不可绕过。

**PathSandbox（路径沙箱）—— Layer 2**
对所有文件类工具，解析输入路径 → 解析符号链接 → 前缀比对项目根目录。逃逸即 deny。

**RuleEngine（规则引擎）—— Layer 3**
加载三层 YAML 规则文件，按 glob 匹配找命中的规则。实现 deny-anywhere：任何一层有 deny 就返回 deny；只有无 deny 时 allow 才生效。

**PermissionModeEvaluator（权限模式）—— Layer 4**
定义四档模式对「只读 / 编辑 / Bash」三类工具在未命中规则时的默认行为（放行 / 拒绝 / 需确认）。

**HumanInTheLoop（人在回路回调）—— Layer 5**
不直接实现 UI，暴露异步回调接口。TUI 层注入回调函数来实现用户交互（是 / 否 / 始终允许）。

### 改动点

- **ToolScheduler**——在执行每个 ToolCall 前先调用 PermissionChecker
- **AgentLoopConfig**——新增 permissionMode 和 humanInTheLoop 回调
- **ToolResult**——新增 `permissionDenied` 标记，区分权限拒绝和其他错误
- **CLI 入口**——新增 `--permission-mode` 参数
- **依赖**——新增 `minimatch` 用于 glob 匹配

## 核心数据结构

### PermissionRequest

权限检查的输入，工具执行前构造。

```typescript
interface PermissionRequest {
  toolName: string;             // 工具名，如 "Bash"、"read_file"
  toolType: "file" | "shell" | "search";  // 工具类型分类
  params: Record<string, unknown>;        // 工具调用参数
  cwd: string;                            // 项目根目录（绝对路径，已解析符号链接）
}
```

### PermissionResult

权限检查的输出，二元结果。

```typescript
interface PermissionResult {
  decision: "allow" | "deny";
  layer: 1 | 2 | 3 | 4 | 5;   // 哪一层做出的决策（用于错误提示）
  reason: string;              // 决策原因，例如"黑名单命中: rm -rf /"
  ruleSource?: string;        // 仅 Layer 3 有值，命中的规则来源文件路径
}
```

### Rule

单条规则，从 YAML 文件解析得到。

```typescript
interface Rule {
  toolPattern: string;   // 工具名，如 "Bash"
  paramPattern: string;  // 参数/路径模式，如 "git *"，空字符串表示匹配所有
  action: "allow" | "deny";
  source: string;        // 来源文件路径（用于优先级比较和提示）
}
```

### PermissionMode

四档权限模式的枚举。

```typescript
type PermissionMode = 
  | "default"            // 只读放行，编辑+Bash 需确认
  | "acceptsEdit"        // 只读+编辑放行，Bash 需确认
  | "plan"               // 只读放行，编辑+Bash 拒绝
  | "bypassPermissions"; // 仅黑名单拦截，其余放行
```

模式对「工具分类 × 默认行为」的映射表：

```typescript
const MODE_BEHAVIOR: Record<PermissionMode, Record<ToolCategory, "allow" | "deny" | "ask">>
```

其中 `ToolCategory = "readonly" | "edit" | "shell"`，由 `toolType` + `destructive` 推导。

### HumanInTheLoopCallback

人在回路回调接口，由 TUI 层实现。

```typescript
type HumanChoice = "yes" | "no" | "always_allow";

interface HumanPrompt {
  toolName: string;
  toolCall: string;           // 可读的工具调用摘要，如 "Bash(rm -rf /tmp/cache)"
  reason: string;             // 为什么需要确认（"默认模式下 Bash 命令需确认"）
}

type HumanInTheLoopCallback = (prompt: HumanPrompt) => Promise<HumanChoice>;
```

### PermissionsConfig

三层 YAML 文件解析后的完整配置结构。

```typescript
interface PermissionsConfig {
  rules: Rule[];              // 所有规则展平，保留 source 用于优先级比较
}
```

## 模块设计

### Blocklist（Layer 1）

**职责：** 扫描 shell 命令字符串，匹配危险模式，命中即 deny。不可配置、不可绕过。

**对外接口：**
```typescript
check(command: string): PermissionResult | null
```

返回 `null` 表示未命中，进入下一层。返回 `PermissionResult` 表示已决策。

**内置模式（举例）：**
- `rm\s+(-[rf]+\s+)*\/`——递归强制删除根目录
- `mkfs\.\S+`——格式化文件系统
- `dd\s+if=`——裸 dd 写盘
- `>\/dev\/sd[a-z]`——直接写块设备
- `chmod\s+777\s+\/`——根目录权限放宽
- `:(){ :|:& };:`——fork 炸弹（基本模式）

### PathSandbox（Layer 2）

**职责：** 对文件类工具，解析输入路径 → realpath → 前缀比对 cwd。逃逸即 deny。

**对外接口：**
```typescript
check(request: PermissionRequest): PermissionResult | null
```

只处理 `toolType === "file"` 的工具。非文件工具返回 `null`（不适用，进入下一层）。

**实现要点：**
- 从 params 中提取路径参数（`filePath`、`path` 等）
- 将路径相对 cwd resolve 成绝对路径
- 通过 `fs.realpathSync.native` 解析符号链接
- 前缀比对真实路径是否以 `cwd + "/"` 开头（cwd 自身也需先 realpath）

### RuleEngine（Layer 3）

**职责：** 加载三层 YAML 规则文件，用 glob 匹配找命中的规则，实现 deny-anywhere 否决。

**对外接口：**
```typescript
class RuleEngine {
  constructor(globalPath?: string, projectPath?: string, localPath?: string);
  load(): Promise<void>;                                    // 加载三层 YAML
  check(request: PermissionRequest): PermissionResult | null;
  addRule(rule: Rule): void;                                // 添加会话级临时规则（不持久化）
  persistRule(rule: Rule): Promise<void>;                   // 写入 permissions.local.yaml（持久化）
}
```

**实现要点：**
- 三层 YAML 格式统一：
  ```yaml
  rules:
    - "Bash(git *): allow"
    - "Bash(rm *): deny"
    - "Write(**/*.env): deny"
    - "Bash: allow"              # 等价于 Bash(*): allow，匹配所有 Bash 调用
  ```
- 解析：用正则拆出工具名、模式字符串、动作
- 匹配：用 minimatch 做 global pattern 匹配
- deny-anywhere：先遍历三层找 deny，任意命中立即 deny；无 deny 再遍历三层找 allow
- 文件不存在时不报错，视为空规则集

### PermissionModeEvaluator（Layer 4）

**职责：** 根据当前权限模式和工具分类，返回该模式下的默认行为。

**对外接口：**
```typescript
evaluate(mode: PermissionMode, toolType: string, destructive: boolean): "allow" | "deny" | "ask"
```

**行为映射表：**

| 模式 / 工具分类 | readonly | edit | shell |
|----------------|----------|------|-------|
| default | allow | ask | ask |
| acceptsEdit | allow | allow | ask |
| plan | allow | deny | deny |
| bypassPermissions | allow | allow | allow |

工具分类推导规则：`toolType === "shell"` → shell，否则 `destructive === true` → edit，否则 → readonly。

### PermissionChecker（五层编排器）

**职责：** 封装五层决策链，对外只暴露一个 `check()` 方法。注入所有依赖。

**对外接口：**
```typescript
class PermissionChecker {
  constructor(
    blocklist: Blocklist,
    pathSandbox: PathSandbox,
    ruleEngine: RuleEngine,
    modeEvaluator: PermissionModeEvaluator,
    mode: PermissionMode,
    humanCallback: HumanInTheLoopCallback,
  );

  check(request: PermissionRequest): Promise<PermissionResult>;
}
```

**内部流程（五层决策链）：**
```
1. blocklist.check(command)    → deny | null
2. pathSandbox.check(request)  → deny | null
3. ruleEngine.check(request)   → deny | allow | null
4. modeEvaluator.evaluate(...) → deny | allow | ask
5. await humanCallback(...)    → deny | allow (通过用户选择)
```

### HumanInTheLoop（Layer 5 回调注入）

**职责：** 不做 UI，只定义回调签名。TUI 层在创建 AgentLoop 时注入具体实现。

**回调内部（由 TUI 实现，不在本模块）：**
- 展示工具调用摘要和询问原因
- 等待用户输入（是/否/始终允许）
- 「始终允许」——回调内部调用 `ruleEngine.persistRule()` 写入 `permissions.local.yaml`

### ToolScheduler 改动

**改动点：** 在 `executeTool` 调用前插入 `permissionChecker.check()`。

```
原流程：schedule → executeTool → 返回结果
新流程：schedule → permissionChecker.check → allow → executeTool → 返回结果
                                              → deny  → 返回 PermissionResult 作为 ToolResult
```

- 所有工具都经过 PermissionChecker（允许 Layer 3 规则拦截只读工具，如 `Read(**/*.secret): deny`）
- 权限拒绝时构造一个 `status: "error"` + `permissionDenied: true` 的 ToolResult
- 不抛异常，让 Agent Loop 正常处理

## 文件组织

```
src/
├── permission/
│   ├── types.ts          — PermissionRequest、PermissionResult、Rule、PermissionMode、HumanPrompt 等
│   ├── blocklist.ts      — Layer 1：危险命令黑名单，内置正则列表
│   ├── path-sandbox.ts   — Layer 2：路径解析 + 符号链接 + 前缀比对
│   ├── rule-engine.ts    — Layer 3：三层 YAML 加载、glob 匹配、deny-anywhere
│   ├── mode-evaluator.ts — Layer 4：四档模式行为映射
│   ├── checker.ts        — PermissionChecker：五层编排器，依赖注入
│   └── index.ts          — 统一导出
├── agent/
│   ├── tool-scheduler.ts — 改动：执行前调用 PermissionChecker
│   └── types.ts          — 改动：AgentLoopConfig 新增字段
├── tool/
│   └── types.ts          — 改动：ToolResult 新增 permissionDenied
└── __tests__/
    └── permission/
        ├── blocklist.test.ts
        ├── path-sandbox.test.ts
        ├── rule-engine.test.ts
        ├── mode-evaluator.test.ts
        └── checker.test.ts
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 检查点位置 | ToolScheduler 内，executeTool 之前 | 最接近执行点，不侵入单个工具的 execute 逻辑；只读工具可跳过检查 |
| glob 库 | `minimatch` | Node.js 生态最常用的 glob 实现，轻量，语法跟 shell glob 一致 |
| YAML 解析 | 复用现有的 `yaml` 包 | 已在 config 模块使用，不引入新依赖 |
| Layer 5 UI | 回调注入，不做 UI | 权限模块保持纯逻辑，UI 由 TUI 层实现，便于测试和替换 |
| shell 命令提取 | 从 params.command 取字符串 | 当前只有 run_command 一个 shell 工具，黑名单作用于其 command 参数 |
| 符号链接解析 | `fs.realpathSync.native` | 同步调用，权限检查路径上不宜有异步开销 |
| 路径参数名 | 约定 `filePath`、`path` 优先 | PathSandbox 按约定名从 params 提取路径 |
| 规则格式解析 | 正则 `/工具名(模式): 动作/` 加 minimatch | 一行一条规则，简单可读 |
| 测试策略 | 各层纯逻辑单测 + checker 集成测 | 每层独立可测；checker 集成测验证五层顺序和穿透逻辑 |
