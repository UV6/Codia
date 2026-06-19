# Hook 系统 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/hook/types.ts` | 所有 Hook 类型定义和常量 |
| 新建 | `src/hook/matcher.ts` | 条件表达式匹配，`matchCondition`/`matchField`/`getFieldValue` |
| 新建 | `src/hook/loader.ts` | YAML 加载、三层合并、schema 校验 |
| 新建 | `src/hook/executor.ts` | 四种动作执行 + `substituteTemplate` 模板替换 |
| 新建 | `src/hook/engine.ts` | `HookEngine` 类：`fire`/`fireIntercept`/`loadRules`/`getRules` |
| 新建 | `src/hook/index.ts` | 统一导出 |
| 修改 | `src/agent/tool-scheduler.ts` | 集成 `pre_tool`/`post_tool` Hook 调用 |
| 修改 | `src/agent/loop.ts` | 集成 `turn_start`/`turn_end`/`pre_llm`/`post_llm` Hook 调用 |
| 修改 | `src/chat/chat-service.ts` | 集成 `session_start`/`session_end`，传递 HookEngine 实例给 AgentLoop |
| 修改 | `src/bootstrap/context-builder.ts` | 集成 `startup`/`shutdown` Hook 调用 |
| 新建 | `src/__tests__/hook/types.test.ts` | 类型常量测试 |
| 新建 | `src/__tests__/hook/matcher.test.ts` | 条件匹配器测试 |
| 新建 | `src/__tests__/hook/loader.test.ts` | 加载器与校验测试 |
| 新建 | `src/__tests__/hook/executor.test.ts` | 动作执行器测试 |
| 新建 | `src/__tests__/hook/engine.test.ts` | HookEngine 集成测试 |

---

## T1: 定义 Hook 系统核心类型

**文件：** `src/hook/types.ts`
**依赖：** 无

**步骤：**
1. 定义 `HookEvent` 类型：10 个事件名的字符串联合类型
2. 定义 `INTERCEPT_EVENTS` 常量数组 `["pre_tool"]`
3. 定义 `FieldCondition` 接口：`field`、`equals?`、`not?`、`regex?`、`glob?`
4. 定义 `HookCondition` 接口：`match`（`"all" | "any"`）+ `fields`（`FieldCondition[]`）
5. 定义四种动作接口：`CommandAction`、`PromptAction`、`HttpAction`、`SubagentAction`
6. 定义 `HookAction` 联合类型
7. 定义 `HookControl` 接口：`run_once?`、`background?`、`timeout?`
8. 定义 `HookRule` 接口：`event`、`condition?`、`action`、`control`、`source`
9. 定义 `HookContext` 类型 `Record<string, unknown>`
10. 定义 `HookInterceptResult` 接口：`blocked`、`reason?`
11. 定义 `DEFAULT_CONTROL: Required<HookControl>` 常量 `{ run_once: false, background: false, timeout: 30000 }`
12. 定义 `HookFireOptions` 接口：`onPrompt?: (text: string) => void`

**验证：** `pnpm exec tsc --noEmit` 编译通过，类型无冲突

---

## T2: 实现条件匹配器

**文件：** `src/hook/matcher.ts`
**依赖：** T1

**步骤：**
1. 导入 `minimatch` 和 types
2. 实现 `getFieldValue(context: HookContext, fieldPath: string): string | undefined`——按 `.` 分隔路径递归取值，遇 undefined 或非对象时返回 undefined
3. 实现 `matchField(fc: FieldCondition, context: HookContext): boolean`
   - `field` 必填，从 context 取字段值
   - 值为 `undefined` → 返回 `false`
   - 若 `equals` 存在 → 值完全相同则 `true`
   - 若 `not` 存在 → 值不等于给定值则 `true`
   - 若 `regex` 存在 → `new RegExp(pattern).test(value)` 则 `true`
   - 若 `glob` 存在 → `minimatch(value, pattern, { dot: true })` 则 `true`
   - 多个模式同时存在时全部满足才 `true`（AND）
4. 实现 `matchCondition(condition: HookCondition | undefined, context: HookContext): boolean`
   - `condition` 为 `undefined` → `true`
   - `condition.fields` 为空 → `true`
   - `match === "all"` → `fields.every(f => matchField(f, context))`
   - `match === "any"` → `fields.some(f => matchField(f, context))`

**验证：** 写完 T10 的测试后验证，或临时写一个内联测试脚本验证几个边界情况（编译通过即可先标记完成）

---

## T3: 实现规则加载器

**文件：** `src/hook/loader.ts`
**依赖：** T1

**步骤：**
1. 导入 `existsSync`/`readFileSync`（node:fs）、`parse as parseYaml`（yaml）、types
2. 实现 `validateRule(rule: unknown, source: string): string[]`
   - 不是 object 或 null → `["规则必须为对象"]`
   - `event` 缺失 → `["event 字段必填"]`
   - `event` 不在已知事件列表中 → `["未知事件: ..."]`
   - `action` 缺失 → `["action 字段必填"]`
   - `action.type` 不在四种类型中 → `["未知动作类型: ..."]`
   - `action.type === "command"` 且无 `command` → `["command 字段必填"]`
   - `action.type === "prompt"` 且无 `text` → `["text 字段必填"]`
   - `action.type === "http"` 且无 `url` → `["url 字段必填"]`
   - `action.type === "subagent"` 且无 `prompt` → `["prompt 字段必填"]`
   - `if` 存在时：`match` 必须是 `all` 或 `any`，`fields` 必须是非空数组，每个 field 条件的 `field` 必填且至少有一个匹配模式
   - `control` 存在时：`background === true` 且 event 在拦截事件列表中 → `["拦截事件不允许 background: true"]`
   - `control.timeout` 存在但不为正整数 → `["timeout 必须为正整数"]`
   - 返回错误数组，空数组表示通过
3. 实现 `loadHooksFromFile(filePath: string): HookRule[]`
   - 文件不存在 → `[]`
   - 读取失败 → `[]`
   - YAML 解析失败 → `[]`
   - 取 `parsed.hooks` 数组，不是数组 → `[]`
   - 遍历数组，对每项调用 `validateRule`，校验失败的 `console.warn` 后跳过，通过的收集
   - 通过的规则追加 `source` 字段并应用 `DEFAULT_CONTROL` 默认值
4. 实现 `loadAllHooks(globalPath?, projectPath?, localPath?): HookRule[]`
   - 分别调用 `loadHooksFromFile` 加载三层
   - 按 global + project + local 顺序合并成一个数组返回（local 在末尾）

**验证：** `pnpm exec tsc --noEmit` 编译通过

---

## T4: 实现动作执行器

**文件：** `src/hook/executor.ts`
**依赖：** T1

**步骤：**
1. 导入 `exec`（node:child_process）、types
2. 实现 `substituteTemplate(template: string, context: HookContext): string`
   - 正则匹配 `{{field.path}}` 模式
   - 调用 `getFieldValue`（从 matcher 导入或本地实现）取值
   - 找不到的字段替换为空字符串 `""`
3. 实现 `executeCommand(action: CommandAction, context: HookContext, timeout: number): Promise<string | null>`
   - 对 `action.command` 做模板替换
   - 用 `child_process.exec` 执行，设置 `timeout`、`maxBuffer: 1024 * 1024`
   - 成功时返回 stdout.trim()
   - 失败时 `console.warn` 并返回 `null`
   - 整个包在 try/catch 中
4. 实现 `executePrompt(action: PromptAction, context: HookContext): Promise<string>`
   - 对 `action.text` 做模板替换，返回替换后的文本
5. 实现 `executeHttp(action: HttpAction, context: HookContext, timeout: number): Promise<string | null>`
   - 对 `url`、`headers` 值、`body` 做模板替换
   - 用 `fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeout) })`
   - 成功时收集 response body 文本返回
   - 失败时 `console.warn` 并返回 `null`
   - 整个包在 try/catch 中
6. 实现 `executeSubagent(action: SubagentAction, context: HookContext): Promise<null>`
   - `console.warn("[Hook] subagent action not implemented")`
   - 返回 `null`
7. 实现 `executeAction(action: HookAction, context: HookContext, control: ResolvedControl): Promise<string | null>`
   - 按 `action.type` 分发到对应的 execute 函数
   - 传递 `control.timeout`

**验证：** `pnpm exec tsc --noEmit` 编译通过

---

## T5: 实现 HookEngine

**文件：** `src/hook/engine.ts`
**依赖：** T2, T3, T4

**步骤：**
1. 导入 types、matcher、executor
2. 实现 `HookEngine` 类：
   - 构造函数接收 `HookRule[]` 存为 `this.rules`
   - `loadRules(rules: HookRule[]): void`——替换规则列表，清空 `run_once` 执行集合
   - `getRules(): HookRule[]`——返回当前规则列表的只读副本
3. 私有字段 `runOnceFired: Set<string>` —— 用 `"${source}:${index}"` 作为 key
4. 私有方法 `applyControl(rule: HookRule): boolean`
   - `control.run_once` 且已在 `runOnceFired` 中 → `false`（跳过）
   - 否则标记并返回 `true`
5. 实现 `fire(event: HookEvent, context: HookContext, opts?: HookFireOptions): Promise<void>`
   - 过滤 `this.rules` 中 `rule.event === event` 的规则
   - 对每条规则：
     - 调用 `matchCondition(rule.condition, context)`，不匹配则跳过
     - 调用 `applyControl(rule)`，返回 false 则跳过
     - 若 `rule.control.background` → 异步执行（不 await），错误忽略
     - 否则 `await executeAction(rule.action, context, resolvedControl)`
     - 若 action type 为 prompt 且 `opts.onPrompt` 存在 → 调用 `opts.onPrompt(result)`
   - 不返回任何值
6. 实现 `fireIntercept(event: HookEvent, context: HookContext): Promise<HookInterceptResult>`
   - 过滤 `this.rules` 中 `rule.event === event` 的规则
   - 对每条规则（必须同步等待）：
     - 调用 `matchCondition(rule.condition, context)`，不匹配则跳过
     - 调用 `applyControl(rule)`，返回 false 则跳过
     - `await executeAction(rule.action, context, resolvedControl)`
     - 若结果以 `"REJECT:"` 开头 → 返回 `{ blocked: true, reason: result.slice(7).trim() }`
     - 若结果为 `null`（执行失败）→ 跳过，继续下一条
   - 所有规则处理完毕 → 返回 `{ blocked: false }`

**验证：** `pnpm exec tsc --noEmit` 编译通过

---

## T6: 统一导出

**文件：** `src/hook/index.ts`
**依赖：** T5

**步骤：**
1. 导出所有 types 中的类型和常量
2. 导出 `HookEngine` 类
3. 导出 `loadAllHooks`、`loadHooksFromFile`、`validateRule`
4. 导出 `matchCondition`、`matchField`
5. 导出 `executeAction`、`substituteTemplate`

**验证：** `pnpm exec tsc --noEmit` 编译通过

---

## T7: 集成到 ToolScheduler

**文件：** `src/agent/tool-scheduler.ts`
**依赖：** T6

**步骤：**
1. 导入 `HookEngine`、`HookEvent`
2. 在 `ToolScheduler` 构造函数中增加可选参数 `hookEngine?: HookEngine`
3. 在 `schedule` 方法中，修改 `executeWithPermission` 函数：
   - 在权限检查通过后、`executeTool` 前：调用 `hookEngine.fireIntercept("pre_tool", { tool_name: call.name, params: call.input, cwd: context.cwd })`
   - 若 `blocked === true`：构造 `ToolResult` 返回给模型，内容为 `[系统拦截] 工具 ${name} 被 Hook 规则拒绝：${reason}`
   - 在 `executeTool` 之后：调用 `hookEngine.fire("post_tool", { tool_name: call.name, params: call.input, result, duration: result.metadata?.duration, cwd: context.cwd })`
   - 所有 Hook 调用用 try/catch 包裹，不抛异常

**验证：** `pnpm exec tsc --noEmit` 编译通过，已有工具调度逻辑不受影响

---

## T8: 集成到 AgentLoop

**文件：** `src/agent/loop.ts`
**依赖：** T6

**步骤：**
1. 导入 `HookEngine`
2. 在 `AgentLoop` 构造函数中增加可选参数 `hookEngine?: HookEngine`，存为私有字段 `private hookEngine?: HookEngine`
3. 在 `run` 方法中，创建 `ToolScheduler` 时将 hookEngine 传入：`new ToolScheduler(this.registry, this.hookEngine)`（需要等 T7 完成后 ToolScheduler 构造函数才接受此参数）
4. 在 `run` 方法中增加 Hook 调用点：
   - 轮次开始时（`round_start` yield 之后）：`await hookEngine.fire("turn_start", { round, cwd, message_count: messages.length })`
   - LLM 调用前（stream 变量赋值前）：`await hookEngine.fire("pre_llm", { message_count: messages.length, system_prompt: systemPrompt }, { onPrompt: (text: string) => { /* 追加到 systemPrompt */ } })`
     - 如果有 prompt 注入，将文本追加到 `systemPrompt` 末尾
   - LLM 返回后（stopped/done 判断后）：`await hookEngine.fire("post_llm", { response: result.fullText, usage: result.usage })`
   - 轮次结束时（`round_end` yield 之后）：`await hookEngine.fire("turn_end", { round, stop_reason: "done" | "max_rounds" | ... })`
5. 所有 Hook 调用用 try/catch 包裹

**验证：** `pnpm exec tsc --noEmit` 编译通过，现有 Agent 循环逻辑不受影响

---

## T9: 集成到 ChatService 和 Bootstrap

**文件：** `src/chat/chat-service.ts`、`src/bootstrap/context-builder.ts`
**依赖：** T6

**步骤：**
1. 在 `ChatService` 中：
   - 导入 `HookEngine`、`loadAllHooks`
   - 在构造函数或工厂方法中创建 `HookEngine` 实例，调用 `loadAllHooks` 加载规则
   - 在会话创建时调用 `hookEngine.fire("session_start", { session_id, cwd })`
   - 在会话销毁/结束时调用 `hookEngine.fire("session_end", { session_id, messageCount })`
   - 将 `hookEngine` 实例传递给 `AgentLoop` 和 `ToolScheduler` 的构造函数
2. 在 `context-builder.ts` 或合适的启动入口中：
   - 在 `buildNewSessionContext` 调用后触发 `startup` 事件：`hookEngine.fire("startup", { pid: process.pid, cwd: projectRoot, version })`
   - 注册 `process.on("beforeExit", ...)` 触发 `shutdown` 事件

**验证：** `pnpm exec tsc --noEmit` 编译通过

---

## T10: 编写单元测试

**文件：** `src/__tests__/hook/types.test.ts`、`matcher.test.ts`、`loader.test.ts`、`executor.test.ts`、`engine.test.ts`
**依赖：** T6

**步骤：**
1. **types.test.ts**：验证 `INTERCEPT_EVENTS` 包含 `"pre_tool"`，`DEFAULT_CONTROL` 值正确
2. **matcher.test.ts**：
   - 无条件（`condition` 为 `undefined`）→ `true`
   - `equals` 精确匹配正确/错误值
   - `not` 反向匹配
   - `regex` 正则匹配
   - `glob` 通配符匹配
   - 嵌套字段路径取值 `"params.command"`
   - 字段不存在时返回 `false`
   - `match: "all"` 全部满足 → `true`，部分满足 → `false`
   - `match: "any"` 任一满足 → `true`，全不满足 → `false`
3. **loader.test.ts**：
   - `validateRule` 对合法规则返回空数组
   - 缺失 `event` 时返回错误
   - 未知事件名返回错误
   - 缺失 `action` 时返回错误
   - 未知动作类型返回错误
   - `command` 动作缺 `command` 字段返回错误
   - `prompt` 动作缺 `text` 字段返回错误
   - `http` 动作缺 `url` 字段返回错误
   - `subagent` 动作缺 `prompt` 字段返回错误
   - 拦截事件设 `background: true` 返回错误
   - `timeout` 非正整数返回错误
   - 条件字段中 `field` 缺失返回错误
   - 条件字段中无匹配模式返回错误
   - `if.match` 不在 `["all", "any"]` 中返回错误
4. **executor.test.ts**：
   - `substituteTemplate` 正确替换单层和嵌套字段
   - 缺失字段替换为空字符串
   - `executeCommand` 执行简单命令（如 `echo "hello"`）返回 stdout
   - `executeCommand` 命令失败时返回 `null`
   - `executeHttp` 发送 HTTP 请求并返回响应体文本（用 mock fetch 测试）
   - `executeHttp` 对 URL/headers/body 做模板替换
   - `executeHttp` 网络错误时返回 `null`
   - `executePrompt` 返回替换后的文本
   - `executeSubagent` 返回 `null`
5. **engine.test.ts**：
   - `fire` 对无匹配规则的事件不执行任何动作
   - `fire` 匹配的规则执行动作
   - `fireIntercept` 对 stdout 含 `REJECT:` 的规则返回 `{ blocked: true }`
   - `fireIntercept` 对普通输出返回 `{ blocked: false }`
   - `run_once` 规则同会话中只执行一次
   - `background` 规则不阻塞 fire 返回
   - 动作失败不抛出异常
6. 运行 `pnpm test`，所有测试通过

**验证：** `pnpm test` 全部通过

---

## 执行顺序

```
T1 (types)
 │
 ├── T2 (matcher) ──┐
 ├── T3 (loader) ───┤
 └── T4 (executor) ─┘
          │
          ▼
     T5 (engine)
          │
          ▼
     T6 (index)
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
T7 (scheduler)  T10 (tests)
    │
    ▼
T8 (loop)
    │
    ▼
T9 (service+bootstrap)
```

T2/T3/T4 可并行（都是纯逻辑模块，只依赖 T1 的类型定义）。
T7/T8/T9 之间有集成顺序（先改 ToolScheduler，再改 AgentLoop，最后改 ChatService 整体串联）。
T10 在 T6 之后即可开始，可与 T7-T9 并行。
