# Agent Loop Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/agent/types.ts` | AgentEvent、StopReason、AgentLoopConfig、StreamResult 类型定义 |
| 新建 | `src/agent/stream-collector.ts` | StreamCollector，双重输出收集器 |
| 新建 | `src/agent/tool-scheduler.ts` | ToolScheduler，按安全性分批执行 |
| 新建 | `src/agent/plan-mode.ts` | Plan Mode prompt、命令解析、工具过滤 |
| 新建 | `src/agent/loop.ts` | AgentLoop，ReAct 核心循环 |
| 修改 | `src/tool/registry.ts` | 新增按 readOnly/destructive 过滤方法 |
| 修改 | `src/chat/chat-service.ts` | 重构 sendMessage，改为调用 AgentLoop |
| 修改 | `src/config/index.ts` | 新增 agentLoop 配置项 |
| 新建 | `src/__tests__/agent/stream-collector.test.ts` | StreamCollector 单元测试 |
| 新建 | `src/__tests__/agent/tool-scheduler.test.ts` | ToolScheduler 单元测试 |
| 新建 | `src/__tests__/agent/plan-mode.test.ts` | Plan Mode 逻辑测试 |
| 新建 | `src/__tests__/agent/loop.test.ts` | AgentLoop 单元测试（mock provider） |

---

## T1: 定义 Agent 层类型

**文件：** `src/agent/types.ts`
**依赖：** 无
**步骤：**
1. 从 `provider/types.ts` 导入 Chunk、Message，从 `tool/types.ts` 导入 ToolCall、ToolResult
2. 定义 `StopReason` 类型：`"done" | "max_rounds" | "cancelled" | "unknown_tool" | "stream_error"`
3. 定义 `AgentLoopConfig` 接口：`maxRounds: number; mode: "full" | "plan"; planFilePath?: string`
4. 定义 `AgentEvent` 联合类型，既包括 Chunk 中的事件（text/thinking/tool_use/tool_use_start/tool_input_delta/usage/error/done），也包括 Agent 层特有事件（tool_result/round_start/round_end/stopped）
5. 定义 `StreamResult` 接口：`fullText: string; toolCalls: ToolCall[]; usage?: {...}; hadError: boolean`
6. 定义 `ScheduleResult` 接口：`callId: string; name: string; result: ToolResult`

**验证：** `pnpm typecheck` 通过

---

## T2: 实现 StreamCollector

**文件：** `src/agent/stream-collector.ts`
**依赖：** T1
**步骤：**
1. 创建 `StreamCollector` 类，构造函数接收 `AsyncIterable<Chunk>`
2. 实现 `AsyncGenerator<AgentEvent>`，消费 Chunk 流：每收到 text/thinking/tool_use_start/tool_input_delta/tool_use 事件立刻 yield
3. 维护内部状态：`fullText`（拼接所有 text chunk）、`toolCalls`（收集所有 tool_use）、`usage`（最后收到的 usage）、`hadError`（是否出现 error 事件）
4. 消费完流后，提供 `getResult(): StreamResult` 方法返回完整收集结果
5. 边界处理：流中间出现 error 时，收集已完成的 tool_use 后标记 hadError

**验证：** `pnpm typecheck` 通过

---

## T3: 实现 ToolScheduler

**文件：** `src/agent/tool-scheduler.ts`
**依赖：** T1
**步骤：**
1. 创建 `ToolScheduler` 类，构造函数接收 `Map<string, Tool>`
2. 实现 `schedule(calls: ToolCall[], context: ToolContext): Promise<ScheduleResult[]>`
3. 按 `Tool.destructive` 标签分割：destructive=false（只读）的工具用 `Promise.all` 并发执行；destructive=true 的工具用 for-await 串行执行
4. 执行单个工具时复用现有 `executeTool()` 函数
5. 合并结果时保持与输入 ToolCall 数组相同的顺序
6. 每个工具执行失败不抛异常，把错误结果正常放入返回值

**验证：** `pnpm typecheck` 通过

---

## T4: 实现 Plan Mode

**文件：** `src/agent/plan-mode.ts`
**依赖：** T1
**步骤：**
1. 定义 `PLAN_MODE_PROMPT` 常量：告诉模型只能用只读工具探索代码，将执行计划写入指定 plan file
2. 实现 `isPlanCommand(text: string): boolean` — 判断用户输入是否以 `/plan` 开头
3. 实现 `isDoCommand(text: string): boolean` — 判断用户输入是否以 `/do` 开头
4. 实现 `filterReadOnlyTools(tools: Tool[]): ToolMeta[]` — 过滤出 readOnly=true 的工具，返回它们的 ToolMeta

**验证：** `pnpm typecheck` 通过

---

## T5: ToolRegistry 扩展过滤方法

**文件：** `src/tool/registry.ts`
**依赖：** 无
**步骤：**
1. 新增 `getReadOnlyTools(): Tool[]` 方法，返回所有 `readOnly === true` 的工具
2. 新增 `getToolMap(): ReadonlyMap<string, Tool>` 方法，返回内部 tools Map 的只读引用
3. 新增 `getMetasByTools(tools: Tool[]): ToolMeta[]` 方法，给一组 Tool 返回其 ToolMeta 数组

**验证：** `pnpm typecheck` 通过

---

## T6: 实现 AgentLoop

**文件：** `src/agent/loop.ts`
**依赖：** T1, T2, T3, T4, T5
**步骤：**
1. 创建 `AgentLoop` 类，构造函数接收 `ToolRegistry`
2. 实现 `async *run(messages, provider, config, signal): AsyncIterable<AgentEvent>` 方法
3. 核心循环逻辑：
   - while round < config.maxRounds:
     - yield round_start
     - 根据 config.mode 选择工具列表
     - 调用 provider.streamChat()，结果传入 StreamCollector
     - for await collector 转发所有事件
     - 从 collector.getResult() 获取完整结果
     - 判断停止条件
     - 保存 assistant 消息到 messages[]
     - 创建 ToolScheduler 并调用 schedule()，yield 每个 tool_result
     - 检测 unknown_tool
     - 工具结果回灌到 messages[]
     - round++，yield round_end
   - yield stopped(reason)
4. AgentLoop 不负责消息持久化（JSONL 写入），只负责修改内存中的 messages[] 数组

**验证：** `pnpm typecheck` 通过

---

## T7: ChatService 重构

**文件：** `src/chat/chat-service.ts`
**依赖：** T6
**步骤：**
1. 移除 `MAX_TOOL_ROUNDS` 常量和内联的循环逻辑
2. 新增 `mode: "full" | "plan"` 私有状态字段
3. `sendMessage()` 方法重写，返回类型改为 `AsyncIterable<AgentEvent>`：
   - 检测 `/plan` 命令：设置 mode = "plan"，构造含 PLAN_MODE_PROMPT 的 system 消息，用 plan mode 配置调用 AgentLoop.run()
   - 检测 `/do` 命令：若当前 mode 为 "plan" 则切为 "full"，否则无操作
   - 普通消息：用当前 mode 调用 AgentLoop.run()
   - AgentLoop.run() 返回的 AgentEvent 直接 yield 给调用方，不做额外转换
4. 保持消息历史管理和 JSONL 持久化逻辑不变
5. 保持 `cancel()` 方法通过 AbortController 传递取消信号

**验证：** `pnpm typecheck` 通过，现有 e2e 测试可编译（测试中可能用到的类型需对应调整）

---

## T8: 配置扩展

**文件：** `src/config/index.ts`
**依赖：** 无
**步骤：**
1. 新增 `agentLoop` 可选字段到配置解析：`maxRounds?: number`（默认 20）
2. `loadConfig()` 中解析可选的 `agent_loop.max_rounds` YAML 字段
3. 如果 YAML 中未配置，使用默认值 20

**验证：** `pnpm typecheck` 通过，`pnpm test -- config.test.ts` 通过

---

## T9: 单元测试 — StreamCollector

**文件：** `src/__tests__/agent/stream-collector.test.ts`
**依赖：** T2
**步骤：**
1. 测试纯文本流 → getResult().fullText 完整拼接
2. 测试含 tool_use 的流 → getResult().toolCalls 收集正确
3. 测试每个 chunk 都被实时转发
4. 测试流中有 error 事件 → hadError 为 true
5. 测试多文本块 + 多 tool_use 交错 → 转发和收集同时正确

**验证：** `pnpm test -- stream-collector.test.ts` 全部通过

---

## T10: 单元测试 — ToolScheduler

**文件：** `src/__tests__/agent/tool-scheduler.test.ts`
**依赖：** T3
**步骤：**
1. 构造 mock Tool 实例，测试分批逻辑
2. 测试两个只读工具并发执行
3. 测试两个 destructive 工具串行执行
4. 测试混合工具调用按原始顺序返回结果
5. 测试单个工具执行失败不抛异常

**验证：** `pnpm test -- tool-scheduler.test.ts` 全部通过

---

## T11: 单元测试 — Plan Mode

**文件：** `src/__tests__/agent/plan-mode.test.ts`
**依赖：** T4
**步骤：**
1. 测试 `isPlanCommand("/plan 重构认证模块")` → true
2. 测试 `isPlanCommand("帮我写个计划")` → false
3. 测试 `isDoCommand("/do")` → true
4. 测试 `filterReadOnlyTools()` 只返回 readOnly=true 的工具
5. 测试 `PLAN_MODE_PROMPT` 包含关键约束词

**验证：** `pnpm test -- plan-mode.test.ts` 全部通过

---

## T12: 单元测试 — AgentLoop

**文件：** `src/__tests__/agent/loop.test.ts`
**依赖：** T6
**步骤：**
1. 构造 mock LLMProvider，返回预设 Chunk 序列
2. 测试纯文本响应 → 一轮结束，stop reason = done
3. 测试文本 + tool_use → 工具执行后继续，最终 done
4. 测试达到 maxRounds → stop reason = max_rounds
5. 测试取消信号 → stop reason = cancelled
6. 测试流错误（mock provider 发送 error 事件）→ stop reason = stream_error
7. 测试所有工具都不存在 → stop reason = unknown_tool
8. 测试 plan mode 下只传递只读工具的 meta

**验证：** `pnpm test -- loop.test.ts` 全部通过

---

## 执行顺序

```
T1 (types)
│
├─ T2 (StreamCollector) ──┐
├─ T3 (ToolScheduler)  ──┤
├─ T4 (Plan Mode)      ──┼─ T6 (AgentLoop) ── T7 (ChatService)
├─ T5 (ToolRegistry)   ──┤
│                          │
├─ T8 (Config)            │
│                          │
└──────────────────────────┴─ T9-T12 (Tests, 可与 T7 并行)
```
