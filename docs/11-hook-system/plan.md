# Hook 系统 Plan

## 架构概览

Hook 系统由四个核心模块组成，以 `HookEngine` 为调度中枢：

```
hooks.yaml (三层)                   AgentLoop / ChatService / Bootstrap
     │                                        │
     ▼                                        ▼
┌──────────┐                          ┌──────────────┐
│  Loader  │──(校验后的规则)──▶  │  HookEngine  │
└──────────┘                          │              │
                                      │  fire(event, │
┌──────────┐                          │   context)   │
│ Matcher  │◀──(条件匹配)────│              │
└──────────┘                          │  返回结果:    │
                                      │  - void      │
┌──────────┐                          │  - reject    │
│ Executor │◀──(执行动作)────│              │
└──────────┘                          └──────────────┘
```

- **Loader**：从三层 YAML 文件加载规则，完成 schema 校验，返回 `HookRule[]`
- **HookEngine**：持有已加载的规则列表，提供 `fire(event, context)` 和 `fireIntercept(event, context)` 两个入口
- **Matcher**：纯函数，判断单条规则的条件是否匹配事件上下文，复用 `minimatch` 做 glob 匹配
- **Executor**：执行具体动作，处理模板替换、超时、后台异步、错误隔离

### 架构如何满足 spec 的每条 F 需求

| F# | 对应模块 | 说明 |
|----|---------|------|
| F1 | Loader | YAML 加载 + schema 校验，三层文件合并 |
| F2 | HookEngine | `fire()` 和 `fireIntercept()` 两个方法对应对普通事件和拦截事件 |
| F3 | Matcher | `matchCondition()` 实现字段匹配 + 逻辑组合 |
| F4 | Executor | `executeCommand()` 处理 shell 命令动作 |
| F5 | Executor | `executePrompt()` 返回注入文本，由调用方拼入消息 |
| F6 | Executor | `executeHttp()` 发送 HTTP 请求 |
| F7 | Executor | `executeSubagent()` 占位，记录日志后返回 null |
| F8 | HookEngine + Executor | `control` 字段在 engine 层解析，传给 executor 控制行为 |
| F9 | HookEngine | `fireIntercept()` 收集动作结果，检测 `REJECT:` 前缀，构造拒绝响应 |
| F10 | Executor | 所有 `execute*` 函数内部 try/catch，失败只记 log 不抛异常 |

---

## 核心数据结构

### HookEvent

```typescript
// 生命周期事件枚举
export type HookEvent =
  | "startup"
  | "shutdown"
  | "session_start"
  | "session_end"
  | "turn_start"
  | "turn_end"
  | "pre_llm"
  | "post_llm"
  | "pre_tool"
  | "post_tool";

// 拦截事件列表（用于校验 background 约束）
export const INTERCEPT_EVENTS: HookEvent[] = ["pre_tool"];
```

### HookRule

```typescript
// 一条完整的 Hook 规则
export interface HookRule {
  event: HookEvent;
  condition?: HookCondition; // 省略时无条件触发
  action: HookAction;
  control: HookControl;
  source: string; // 来源文件路径，用于日志
}
```

### HookCondition

```typescript
// 条件表达式
export interface HookCondition {
  match: "all" | "any"; // 逻辑组合方式
  fields: FieldCondition[]; // 字段条件列表
}

// 单字段条件
export interface FieldCondition {
  field: string; // 字段路径，如 "params.command"
  equals?: string; // 精确匹配
  not?: string; // 反向匹配
  regex?: string; // 正则匹配
  glob?: string; // glob 匹配
}
```

### HookAction

```typescript
// 动作联合类型
export type HookAction =
  | CommandAction
  | PromptAction
  | HttpAction
  | SubagentAction;

export interface CommandAction {
  type: "command";
  command: string; // 支持 {{var}} 模板
}

export interface PromptAction {
  type: "prompt";
  text: string; // 支持 {{var}} 模板
}

export interface HttpAction {
  type: "http";
  url: string;
  method?: string; // 默认 "POST"
  headers?: Record<string, string>;
  body?: string; // JSON 字符串，支持 {{var}} 模板
}

export interface SubagentAction {
  type: "subagent";
  prompt: string; // 支持 {{var}} 模板
}
```

### HookControl

```typescript
// 执行控制参数
export interface HookControl {
  run_once?: boolean; // 默认 false，同一会话只执行一次
  background?: boolean; // 默认 false，异步执行不等待
  timeout?: number; // 默认 30000ms
}

// 应用默认值后的完整 control
export type ResolvedControl = Required<HookControl>;
```

### HookContext

```typescript
// 事件上下文——不同事件携带不同字段
// 用 Record 保持灵活，在 fire 调用点由调用方构造
export type HookContext = Record<string, unknown>;
```

各事件上下文字段参考（统一使用 snake_case，此表为权威定义，覆盖 spec、plan、task 所有引用）：

| 事件 | 上下文字段 | 类型 | 提供方 |
|------|-----------|------|--------|
| `startup` | `pid`, `cwd`, `version` | `number`, `string`, `string` | Bootstrap |
| `shutdown` | `pid`, `uptime` | `number`, `number` | Bootstrap |
| `session_start` | `session_id`, `cwd` | `string`, `string` | ChatService |
| `session_end` | `session_id`, `message_count` | `string`, `number` | ChatService |
| `turn_start` | `round`, `cwd`, `message_count` | `number`, `string`, `number` | AgentLoop |
| `turn_end` | `round`, `stop_reason` | `number`, `string` | AgentLoop |
| `pre_llm` | `message_count`, `system_prompt` | `number`, `string?` | AgentLoop |
| `post_llm` | `response`, `usage` | `string`, `object?` | AgentLoop |
| `pre_tool` | `tool_name`, `params`, `cwd` | `string`, `object`, `string` | ToolScheduler |
| `post_tool` | `tool_name`, `params`, `result`, `duration`, `cwd` | `string`, `object`, `object`, `number`, `string` | ToolScheduler |

### HookFireOptions

```typescript
// fire() 的额外选项
export interface HookFireOptions {
  onPrompt?: (text: string) => void; // prompt 动作文本的回调
}
```

### HookFireResult

```typescript
// fire() 的返回值（普通事件无返回值）
export type HookFireResult = void;

// fireIntercept() 的返回值
export interface HookInterceptResult {
  blocked: boolean;
  reason?: string; // 拒绝原因（blocked=true 时）
}
```

---

## 模块设计

### 模块 A: types.ts

**职责：** 定义所有 Hook 相关的 TypeScript 类型和常量。

**对外接口：**
- 所有类型导出（见上方数据结构）
- `INTERCEPT_EVENTS` 常量
- `DEFAULT_CONTROL: ResolvedControl` 常量 `{ run_once: false, background: false, timeout: 30000 }`

**依赖：** 无

### 模块 B: loader.ts

**职责：** 从 YAML 文件加载 Hook 规则，完成 schema 校验。

**对外接口：**
```typescript
// 加载单文件
function loadHooksFromFile(filePath: string): HookRule[];

// 加载三层配置并合并
function loadAllHooks(
  globalPath?: string,
  projectPath?: string,
  localPath?: string
): HookRule[];

// 校验单条规则，返回错误信息列表（空数组表示通过）
function validateRule(rule: unknown, source: string): string[];
```

**校验规则：**
- `event` 必填且在已知事件列表中
- `if` 可选，存在时且非空时 `match` 必须是 `all` 或 `any`，`fields` 必须是非空数组；`if` 为 `{}` 或 `fields` 为空数组时视为无条件触发，从规则中移除 `condition` 字段
- 每个 field 条件中 `field` 必填，且 `equals`/`not`/`regex`/`glob` 至少有一个
- `action` 必填，`type` 必须是 `command`/`prompt`/`http`/`subagent` 之一
- `action.type === "command"` 时 `command` 必填
- `action.type === "prompt"` 时 `text` 必填
- `action.type === "http"` 时 `url` 必填
- `action.type === "subagent"` 时 `prompt` 必填
- `control.background === true` 且 event 是拦截事件时校验失败
- `control.timeout` 若存在必须为正整数

**依赖：** types.ts、`node:fs`、`yaml`

### 模块 C: matcher.ts

**职责：** 纯函数，判断条件是否匹配事件上下文。

**对外接口：**
```typescript
// 判断规则条件是否匹配给定上下文
function matchCondition(
  condition: HookCondition | undefined,
  context: HookContext
): boolean;

// 判断单字段条件
function matchField(
  fc: FieldCondition,
  context: HookContext
): boolean;

// 从 context 中按点分隔路径取值（如 "params.command" → context.params?.command）
function getFieldValue(context: HookContext, fieldPath: string): string | undefined;
```

**匹配逻辑：**
1. `condition` 为 `undefined` 或 `condition.fields` 为空 → `true`（无条件触发，`if: {}` 由 loader 归一化）
2. 从 `context` 中取字段值，值为 `undefined` 时该字段条件视为不满足
3. 对每个 `FieldCondition`，检查指定的匹配模式（`equals`/`not`/`regex`/`glob`）
4. `regex` 匹配用 `new RegExp(pattern).test(value)`
5. `glob` 匹配复用 `minimatch(value, pattern, { dot: true })`
6. `match: "all"` → 所有字段条件都满足才为 `true`
7. `match: "any"` → 任一字段条件满足即为 `true`

**依赖：** types.ts、`minimatch`

### 模块 D: executor.ts

**职责：** 执行具体动作，处理模板替换、超时控制、错误隔离。

**对外接口：**
```typescript
// 模板替换：将 "{{field}}" 替换为 context 中的值
function substituteTemplate(template: string, context: HookContext): string;

// 执行单个动作
async function executeAction(
  action: HookAction,
  context: HookContext,
  control: ResolvedControl
): Promise<string | null>;
// 返回动作的输出文本，失败时返回 null

// 执行子 Agent 动作（占位）
async function executeSubagent(
  action: SubagentAction,
  context: HookContext
): Promise<null>;
```

**执行细节：**

- **command**：用 `child_process.exec` 执行，设置 `timeout` 和 `maxBuffer`，收集 stdout
- **prompt**：返回 `substituteTemplate(action.text, context)` 文本
- **http**：用 `fetch` 发送请求（Node 18+ 内置），设置 `AbortSignal.timeout(control.timeout)`
- **subagent**：记录 warn 日志 `"subagent action not implemented"`，返回 `null`

**错误隔离：**
- 每个 `execute*` 函数内部 `try/catch` 所有异常
- 异常时用 `console.warn` 记录，返回 `null`
- 绝不向上抛出异常

**依赖：** types.ts、`node:child_process`

### 模块 E: engine.ts

**职责：** 调度中枢，持有规则列表，提供 `fire` 和 `fireIntercept` 两个入口。

**对外接口：**
```typescript
export class HookEngine {
  constructor(rules: HookRule[]);

  // 触发普通事件 — 匹配规则，执行动作，不关心返回值
  // opts.onPrompt: prompt 动作文本的回调，调用方用于注入到上下文中
  async fire(event: HookEvent, context: HookContext, opts?: HookFireOptions): Promise<void>;

  // 触发拦截事件 — 匹配规则，执行动作，检测 REJECT 信号
  async fireIntercept(
    event: HookEvent,
    context: HookContext
  ): Promise<HookInterceptResult>;

  // 加载/重载规则
  loadRules(rules: HookRule[]): void;

  // 获取规则列表（用于测试/调试）
  getRules(): HookRule[];
}
```

**fire() 流程：**
```
1. 过滤出匹配 event 的规则
2. 对每条规则：
   a. 调用 matchCondition() 检查条件
   b. 不匹配 → 跳过
   c. 匹配 + control.run_once → 检查已执行集合，已执行则跳过
   d. 匹配 + control.background → 异步执行（不 await）
   e. 匹配 + 非 background → await executeAction()
3. 忽略所有错误
```

> **prompt 动作说明：** prompt 动作的文本通过 `opts.onPrompt` 回调传递给调用方。若调用方未提供此回调（或事件并非 `pre_llm` 等关心注入的事件），prompt 文本被静默丢弃。

**fireIntercept() 流程：**
```
1. 过滤出匹配 event 的规则
2. 对每条规则（必须同步等待，不允许 background）：
   a. 调用 matchCondition() 检查条件
   b. 不匹配 → 跳过
   c. await executeAction()
   d. 检查 stdout 是否以 "REJECT:" 开头
   e. 是 → 返回 { blocked: true, reason: ... }
   f. 否 → 继续下一条
3. 返回 { blocked: false }
```

**依赖：** types.ts、matcher.ts、executor.ts

---

## 模块交互

### 流程 1: 普通事件（以 turn_start 为例）

```
AgentLoop.run()
  │
  ├─ yield { type: "round_start" }
  ├─ hookEngine.fire("turn_start", { round, messages: [...], cwd })
  │    │
  │    ├─ Matcher: 匹配 event === "turn_start" 的规则
  │    ├─ Matcher: 对每条规则检查 if 条件
  │    ├─ Executor: 执行匹配规则的动作
  │    │    ├─ command → exec()
  │    │    ├─ prompt  → 返回文本（由调用方决定如何注入，turn_start 场景丢弃）
  │    │    ├─ http    → fetch()
  │    │    └─ subagent → warn + null
  │    └─ 错误 → console.warn
  │
  ├─ ... 继续 Agent 循环 ...
```

### 流程 2: 拦截事件 pre_tool

```
ToolScheduler.schedule()
  │
  ├─ (现有权限检查)
  ├─ hookEngine.fireIntercept("pre_tool", { tool_name, params, cwd })
  │    │
  │    ├─ Matcher: 匹配 event === "pre_tool" 的规则
  │    ├─ Matcher: 对每条规则检查 if 条件
  │    ├─ Executor: await executeAction()   ← 必须同步等待
  │    ├─ 检查 stdout 前缀
  │    │    ├─ "REJECT: ..." → { blocked: true, reason: "..." }
  │    │    └─ 其他          → 继续下一条
  │    └─ 错误 → console.warn，放行
  │
  ├─ if blocked:
  │    └─ 构造假的 ToolResult:
  │         content: `[系统拦截] 工具 ${name} 被 Hook 规则拒绝：${reason}`
  │         → 返回给 AgentLoop → 回灌到 messages
  │
  └─ if not blocked: 正常执行工具
```

### 流程 3: 提示词注入 pre_llm

```
AgentLoop.run()
  │
  ├─ ... 准备 messages ...
  ├─ hookEngine.fire("pre_llm", { messages, system_prompt })
  │    │
  │    ├─ 匹配 event === "pre_llm" 的规则
  │    └─ prompt 动作的文本通过回调/事件收集
  │
  ├─ 将收集到的注入文本追加到 system_prompt 末尾
  ├─ 调用 LLM
```

> **设计决策：** `pre_llm` + `prompt` 动作的注入在 `fire()` 返回值中不便传递（fire 是 fire-and-forget）。实际实现时 `fire()` 增加一个可选参数 `onPrompt?: (text: string) => void`，prompt 动作执行时调用该回调，由调用方决定如何注入。

### 流程 4: 系统事件

```
bootstrap/startup:
  hookEngine.fire("startup", { pid: process.pid, version, cwd })

shutdown (process.on("beforeExit")):
  hookEngine.fire("shutdown", { pid: process.pid, uptime })
```

---

## 文件组织

```
src/hook/
├── types.ts      — HookEvent, HookRule, HookCondition, HookAction, HookControl, HookContext, HookFireResult 等类型定义
├── loader.ts     — loadHooksFromFile, loadAllHooks, validateRule 及 YAML schema 校验
├── matcher.ts    — matchCondition, matchField, getFieldValue 条件匹配
├── executor.ts   — executeAction, executeCommand, executePrompt, executeHttp, executeSubagent, substituteTemplate
├── engine.ts     — HookEngine 类：fire, fireIntercept, loadRules, getRules
└── index.ts      — 统一导出
```

## 集成点（修改现有文件）

| 文件 | 集成方式 |
|------|---------|
| `src/agent/loop.ts` | 在 `round_start` 后调用 `hookEngine.fire("turn_start", ...)`，在 `round_end` 后调用 `hookEngine.fire("turn_end", ...)`，在 LLM 调用前调用 `hookEngine.fire("pre_llm", ...)`，在 LLM 返回后调用 `hookEngine.fire("post_llm", ...)` |
| `src/agent/tool-scheduler.ts` | 在工具执行前调用 `hookEngine.fireIntercept("pre_tool", ...)`，在工具执行后调用 `hookEngine.fire("post_tool", ...)` |
| `src/chat/chat-service.ts` | 在会话创建/结束时触发 `session_start`/`session_end` |
| `src/bootstrap/` | 在启动完成后触发 `startup`，注册 `shutdown` 处理器 |

---

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 条件表达式格式 | 结构化 YAML (`fields` + `match`) | 用户选择；好校验、不容易写错、IDE 能自动补全 |
| glob 匹配库 | minimatch（复用） | 权限系统已用，保持一致性，零额外依赖 |
| 模板替换语法 | `{{field.path}}` | 简洁通用，类似 Mustache/Ansible，无歧义 |
| HTTP 客户端 | Node 内置 `fetch` | Node 18+ 原生支持，零依赖；超时通过 `AbortSignal.timeout()` |
| Shell 执行 | `child_process.exec` | 需要捕捉 stdout/stderr，exec 比 spawn 更简单 |
| 拦截信号 | stdout 前缀 `REJECT:` | 简单明确，不需要额外的 IPC 协议；任何语言写的脚本都能发出 |
| YAML 校验 | 手写 `validateRule()` | 规则结构不复杂（~10个字段），引入 zod/ajv 过度 |
| 错误隔离 | try/catch + console.warn | 完全隔离，不抛异常，不中断主流程 |
| Hook 配置文件 | 复用权限系统的三层路径 | 与现有配置体系一致，用户已有心智模型 |
| 子 Agent 动作 | 占位 + 日志 | 避免依赖未实现的功能，接口预留方便后续对接 |
| prompt 动作结果传递 | `fire()` 增加 `onPrompt` 回调 | prompt 文本需要注入到调用方上下文中，fire-and-forget 无法传递 |
