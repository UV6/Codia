# Codia 权限系统 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/permission/types.ts` | PermissionRequest、PermissionResult、Rule、PermissionMode 等类型定义 |
| 新建 | `src/permission/mode-evaluator.ts` | Layer 4：四档模式行为映射 |
| 新建 | `src/permission/blocklist.ts` | Layer 1：危险命令黑名单 |
| 新建 | `src/permission/path-sandbox.ts` | Layer 2：路径沙箱 |
| 新建 | `src/permission/rule-engine.ts` | Layer 3：规则引擎 |
| 新建 | `src/permission/checker.ts` | PermissionChecker 五层编排器 |
| 新建 | `src/permission/index.ts` | 统一导出 |
| 修改 | `src/tool/types.ts` | ToolResult 新增 permissionDenied 字段 |
| 修改 | `src/agent/types.ts` | AgentLoopConfig 新增 permissionMode 和 humanInTheLoop |
| 修改 | `src/agent/tool-scheduler.ts` | 执行前插入权限检查 |
| 新建 | `src/__tests__/permission/blocklist.test.ts` | Layer 1 测试 |
| 新建 | `src/__tests__/permission/path-sandbox.test.ts` | Layer 2 测试 |
| 新建 | `src/__tests__/permission/rule-engine.test.ts` | Layer 3 测试 |
| 新建 | `src/__tests__/permission/mode-evaluator.test.ts` | Layer 4 测试 |
| 新建 | `src/__tests__/permission/checker.test.ts` | 集成测试：五层决策链 |

## T1: 定义权限相关类型

**文件：** `src/permission/types.ts`
**依赖：** 无
**步骤：**
1. 定义 `PermissionRequest`——toolName、toolType、params、cwd
2. 定义 `PermissionResult`——decision、layer、reason、ruleSource
3. 定义 `Rule`——toolPattern、paramPattern、action、source
4. 定义 `PermissionMode`—— `"default" | "acceptsEdit" | "plan" | "bypassPermissions"`
5. 定义 `ToolCategory`—— `"readonly" | "edit" | "shell"`
6. 定义 `HumanChoice`—— `"yes" | "no" | "always_allow"`
7. 定义 `HumanPrompt`——toolName、toolCall、reason
8. 定义 `HumanInTheLoopCallback`——函数签名

**验证：** `pnpm typecheck` 通过

## T2: 实现 Layer 4 — 权限模式评估器

**文件：** `src/permission/mode-evaluator.ts`
**依赖：** T1
**步骤：**
1. 定义行为映射表常量 `MODE_BEHAVIOR`
2. 实现 `toolTypeToCategory(toolType, destructive)`——将工具类型映射到 ToolCategory
3. 实现 `evaluate(mode, toolType, destructive)`——查表返回 `"allow" | "deny" | "ask"`

**验证：** `pnpm typecheck` 通过

## T3: 实现 Layer 1 — 危险命令黑名单

**文件：** `src/permission/blocklist.ts`
**依赖：** T1
**步骤：**
1. 定义内置危险模式正则数组 `DANGEROUS_PATTERNS`
2. 实现 `check(command: string): PermissionResult | null`
   - 遍历正则，出现第一个匹配就返回 deny（layer=1）
   - 无匹配返回 null
3. 只处理 command 为字符串的情况，非字符串返回 null

**验证：** `pnpm typecheck` 通过

## T4: 实现 Layer 2 — 路径沙箱

**文件：** `src/permission/path-sandbox.ts`
**依赖：** T1
**步骤：**
1. 实现 `extractPaths(params)`——从 params 中提取路径相关的值（filePath、path 等）
2. 实现 `isWithinSandbox(absolutePath, sandboxRoot)`——前缀比对
3. 实现 `check(request)`：
   - 非文件工具（toolType !== "file"）返回 null
   - 对每个提取的路径做 resolve + realpathSync
   - 前缀比对 cwd（cwd 也需 realpath）
   - 任何路径在沙箱外返回 deny（layer=2）
   - 全部在沙箱内返回 null

**验证：** `pnpm typecheck` 通过

## T5: 安装 minimatch 依赖

**文件：** `package.json`
**依赖：** 无
**步骤：**
1. 执行 `pnpm add minimatch`

**验证：** `pnpm add minimatch` 成功，package.json 中出现 minimatch

## T6: 实现 Layer 3 — 规则引擎

**文件：** `src/permission/rule-engine.ts`
**依赖：** T1、T5
**步骤：**
1. 定义 YAML 格式解析器——用正则拆出工具名、模式、动作
2. 实现 `loadRulesFromFile(path)`——读 YAML，解析 rules 数组为 Rule 对象
3. 实现 `matchRule(rule, request)`——用 minimatch 做工具名匹配和参数模式 glob 匹配
4. 实现 `RuleEngine` 类：
   - constructor 接受三个可选路径
   - `load()`——加载三层 YAML，文件不存在不报错
   - `check(request)`——先遍历三层找 deny（命中任意层立即返回），无 deny 再遍历三层找 allow（命中任何一层返回 allow），都无返回 null
   - `addRule(rule)`——添加会话级临时规则到内存
5. 实现 `buildMatchString(toolName, params)`——构造 `工具名(参数摘要)` 字符串用于规则匹配

**验证：** `pnpm typecheck` 通过

## T7: 实现 PermissionChecker 五层编排器

**文件：** `src/permission/checker.ts`
**依赖：** T2、T3、T4、T6
**步骤：**
1. 实现 `PermissionChecker` 类，接收所有依赖注入
2. 实现 `check(request)`：
   - Layer 1: 如果 toolType === "shell"，从 params 提取 command，调用 blocklist.check()
   - Layer 2: 调用 pathSandbox.check()
   - Layer 3: 调用 ruleEngine.check()
   - Layer 4: 调用 modeEvaluator.evaluate()，allow/deny 直接返回，ask 进入 Layer 5
   - Layer 5: 调用 humanCallback，处理返回值（yes → allow, no → deny, always_allow → allow + 调用 ruleEngine.addRule()）

**验证：** `pnpm typecheck` 通过

## T8: 创建统一导出

**文件：** `src/permission/index.ts`
**依赖：** T1-T7
**步骤：**
1. 从各模块重导出所有公开类型和类

**验证：** `pnpm typecheck` 通过

## T9: 修改 ToolResult 和 AgentLoopConfig 类型

**文件：** `src/tool/types.ts`、`src/agent/types.ts`
**依赖：** T1
**步骤：**
1. ToolResult 新增 `permissionDenied?: boolean`
2. AgentLoopConfig 新增 `permissionMode: PermissionMode` 和 `humanInTheLoop?: HumanInTheLoopCallback`

**验证：** `pnpm typecheck` 通过

## T10: 修改 ToolScheduler 接入权限检查

**文件：** `src/agent/tool-scheduler.ts`
**依赖：** T7、T9
**步骤：**
1. schedule 方法新增 PermissionChecker 可选参数
2. 在 executeTool 调用前插入检查：
   - 只读工具跳过检查
   - 构造 PermissionRequest
   - 调用 permissionChecker.check()
   - deny → 构造 permissionDenied 的 ToolResult，不执行工具
   - allow → 正常调用 executeTool

**验证：** `pnpm typecheck` 通过

## T11: Blocklist 测试

**文件：** `src/__tests__/permission/blocklist.test.ts`
**依赖：** T3
**步骤：**
1. 测试 `rm -rf /` 被拦截
2. 测试 `mkfs.ext4 /dev/sda` 被拦截
3. 测试 `git status` 正常放行
4. 测试 `echo hello` 正常放行
5. 测试非 shell 工具（command 为空或非字符串）返回 null

**验证：** `pnpm test -- blocklist` 通过

## T12: PathSandbox 测试

**文件：** `src/__tests__/permission/path-sandbox.test.ts`
**依赖：** T4
**步骤：**
1. 测试项目目录内路径放行
2. 测试绝对路径 `/etc/passwd` 拒绝
3. 测试 `../outside/file.txt` 相对路径逃逸拒绝
4. 测试非文件工具返回 null
5. 测试符号链接逃逸拒绝

**验证：** `pnpm test -- path-sandbox` 通过

## T13: RuleEngine 测试

**文件：** `src/__tests__/permission/rule-engine.test.ts`
**依赖：** T6
**步骤：**
1. 测试精确匹配 `Bash(git status)` 生效
2. 测试 glob 匹配 `Bash(git *)` 生效
3. 测试 deny-anywhere：本地 deny 覆盖项目级 allow
4. 测试三层优先级：本地 > 项目 > 全局
5. 测试无匹配规则返回 null
6. 测试 addRule 添加临时规则并生效

**验证：** `pnpm test -- rule-engine` 通过

## T14: ModeEvaluator 测试

**文件：** `src/__tests__/permission/mode-evaluator.test.ts`
**依赖：** T2
**步骤：**
1. 测试 default 模式：只读 allow、edit ask、shell ask
2. 测试 acceptsEdit 模式：edit 变为 allow
3. 测试 plan 模式：edit deny、shell deny
4. 测试 bypassPermissions 模式：全部 allow

**验证：** `pnpm test -- mode-evaluator` 通过

## T15: PermissionChecker 集成测试

**文件：** `src/__tests__/permission/checker.test.ts`
**依赖：** T7
**步骤：**
1. 测试 Layer 1 穿透到 Layer 2 再穿透的流程
2. 测试 Layer 3 规则命中后跳过后面的层
3. 测试 Layer 4 allow/deny 直接返回，不进入 Layer 5
4. 测试 Layer 5 回调被正确调用，且返回值被正确处理
5. 测试 always_allow 时调用 ruleEngine.addRule()
6. 测试 deny 结果包含正确的 layer 和 reason

**验证：** `pnpm test -- checker` 通过

## 执行顺序

```
T1 (types)
 ├─ T2 (mode evaluator)
 ├─ T3 (blocklist)
 ├─ T4 (path sandbox)
 ├─ T5 (minimatch) → T6 (rule engine)
 └─ T9 (modify existing types)

T2 + T3 + T4 + T6 → T7 (checker) → T8 (index)

T7 + T9 → T10 (modify scheduler)

T3 → T11 (blocklist test)
T4 → T12 (sandbox test)
T6 → T13 (rule engine test)
T2 → T14 (mode evaluator test)
T7 → T15 (checker test)

T10 + T11 + T12 + T13 + T14 + T15 → 全量测试通过
```
