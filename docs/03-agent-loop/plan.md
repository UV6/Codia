# Agent Loop Plan

## 架构概览

当前所有循环逻辑都在 `ChatService.sendMessage()` 一个方法里，且 MAX_TOOL_ROUNDS=1、只取第一个工具调用。需要把循环逻辑抽成独立模块，ChatService 退化为调度层。

核心思路：把 Agent Loop 从 ChatService 中剥离为独立模块，ChatService 只负责"接收命令 → 配置 Agent → 启循环 → 转发事件"。

### 组件划分

**AgentEvent（事件类型）**
定义一套 Agent 层的事件类型，在现有 Chunk 基础上扩展了新事件：文本增量、工具调用、工具执行、工具结果、轮次边界、停止原因。界面消费 AgentEvent（即扩展后的 Chunk 类型），兼容现有渲染逻辑。

**AgentLoop（核心循环）**
ReAct 循环的纯逻辑实现。输入：消息历史 + 工具列表 + Provider + 配置（最大轮数）。输出：`AsyncIterable<AgentEvent>`。内部处理：调用 LLM → 流式收集 → 判断停止条件 → 分批执行工具 → 结果回灌 → 下一轮。

**StreamCollector（流式收集器）**
包装 Provider 的原始 Chunk 流，同时做两件事：每个 text chunk 立刻通过 AgentEvent yield 出去（低延迟），同时把整个响应攒完整——包括完整文本和所有 tool_use——供循环结束时判断。

**ToolScheduler（工具调度器）**
接收一个 ToolCall 数组，按安全性分批：只读工具（readOnly=true, destructive=false）并发执行，有副作用的工具（destructive=true）串行执行。返回执行结果数组，保持与输入 ToolCall 的对应关系。

**ChatService（调度层，改造）**
保留消息历史管理、会话持久化，但循环逻辑移交给 AgentLoop。新增：识别 `/plan` 和 `/do` 命令，在 /plan 模式下注入 plan mode prompt 并限制工具。

## 核心数据结构

### AgentEvent（事件类型）

```typescript
// AgentEvent —— Agent Loop 向外推送的事件类型
// 复用现有 Chunk 的事件 + 新增 Agent 层特有事件
type AgentEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_use"; call: ToolCall }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_input_delta"; partialJson: string }
  | { type: "tool_execution_start"; callId: string; name: string }
  | { type: "usage"; usage: { inputTokens: number; outputTokens: number; model: string } }
  | { type: "error"; error: { code: string; message: string } }
  | { type: "done" }
  | { type: "tool_result"; callId: string; name: string; result: ToolResult }
  | { type: "round_start"; round: number }
  | { type: "round_end"; round: number }
  | { type: "stopped"; reason: StopReason }
```

### StopReason（停止原因）

```typescript
type StopReason =
  | "done"              // 模型自然结束（无工具调用）
  | "max_rounds"        // 达到迭代上限
  | "cancelled"         // 用户取消
  | "unknown_tool"      // 连续请求不存在的工具
  | "stream_error"      // LLM 流输出错误
```

### AgentLoopConfig（循环配置）

```typescript
interface AgentLoopConfig {
  maxRounds: number;        // 迭代上限，默认 20
  mode: "full" | "plan";    // 模式：全能力 / 只读计划
  planFilePath?: string;    // plan mode 下的计划输出文件
}
```

### StreamResult（流式收集结果）

```typescript
interface StreamResult {
  fullText: string;         // 完整文本内容
  toolCalls: ToolCall[];    // 所有工具调用（按顺序）
  usage?: { inputTokens: number; outputTokens: number; model: string };
  hadError: boolean;        // 是否有流错误
}
```

### ScheduleResult（调度结果）

```typescript
interface ScheduleResult {
  callId: string;
  name: string;
  result: ToolResult;
}
```

## 模块设计

### 模块 A: AgentLoop（`agent/loop.ts`）

**职责：** ReAct 循环的核心实现。接收消息历史、Provider、工具列表、配置、取消信号，驱动"调用 LLM → 收集响应 → 判断停止 → 分批执行工具 → 结果回灌 → 下一轮"的循环。

**对外接口：**
- `run(messages, provider, tools, config, signal): AsyncIterable<AgentEvent>` — 启动循环

**依赖：**
- StreamCollector — 包装 Provider 流，同时推送和收集
- ToolScheduler — 将工具调用按安全性分批执行
- ToolRegistry — 查找工具实例和元数据
- LLMProvider — 发起 LLM 调用
- filterReadOnlyTools — 获取只读工具的 ToolMeta

**内部逻辑：**
```
round = 0
while round < config.maxRounds:
  yield { type: "round_start", round }
  tools = config.mode === "plan" ? filterReadOnlyTools(allTools) : allToolMetas
  stream = provider.streamChat(messages, chatConfig, signal, tools)
  collector = new StreamCollector(stream)
  for await (event of collector):
    yield event
  result = collector.getResult()
  // 停止条件判断
  if result.hadError: yield stopped("stream_error"); break
  if result.toolCalls.length === 0: yield stopped("done"); break
  if signal.aborted: yield stopped("cancelled"); break
  // 保存 assistant 消息
  messages.push({ role: "assistant", content: result.fullText, toolCalls: result.toolCalls })
  // 调度执行工具
  scheduler = new ToolScheduler(toolMap)
  results = await scheduler.schedule(result.toolCalls, context)
  for each call: yield { type: "tool_execution_start", callId, name }
  for each result: yield { type: "tool_result", ... }
  // 未知工具检测
  if all results are unknown_tool: yield stopped("unknown_tool"); break
  // 结果回灌
  for each result: messages.push({ role: "user", toolResult, toolUseId })
  round++; yield { type: "round_end", round }
yield stopped("max_rounds")
```

### 模块 B: StreamCollector（`agent/stream-collector.ts`）

**职责：** 双重输出的流式收集器。消费 Provider 的 `AsyncIterable<Chunk>`，对每个 chunk 做两件事：(a) 包装为 AgentEvent 并 yield，(b) 内部累积 text、tool_use、usage。流结束时可获取完整的 StreamResult。

**对外接口：**
- StreamCollector 类，构造函数接收 `AsyncIterable<Chunk>`
- 自身实现 `AsyncIterable<AgentEvent>`
- `getResult(): StreamResult` — 流消费完毕后获取收集结果

**依赖：** 无外部依赖，仅消费 Chunk 流

### 模块 C: ToolScheduler（`agent/tool-scheduler.ts`）

**职责：** 工具调用分批执行策略。按 `destructive` 标签分类：`destructive=false` 的工具并发执行（`Promise.all`），`destructive=true` 的工具串行执行。执行结果按原始 ToolCall 顺序排列。

**对外接口：**
- `schedule(calls, context): Promise<ScheduleResult[]>` — 分批执行

**依赖：**
- executeTool — 单个工具执行器
- Tool, ToolContext 类型

### 模块 D: AgentEvent 类型（`agent/types.ts`）

**职责：** 定义 Agent Loop 层所有事件类型和配置类型。

**对外接口：**
- AgentEvent type, StopReason type, AgentLoopConfig interface, StreamResult interface, ScheduleResult interface

**依赖：** 复用 provider/types.ts 的 Chunk、Message，tool/types.ts 的 ToolCall、ToolResult

### 模块 E: Plan Mode（`agent/plan-mode.ts`）

**职责：** Plan Mode 的 prompt 构造和工具过滤。不是在 Registry 层面把写工具删掉，而是通过 prompt 告诉模型行为约束，同时过滤工具列表让 LLM 看不到写工具。处理 `/plan` 和 `/do` 命令的解析。

**对外接口：**
- `PLAN_MODE_PROMPT: string` — plan mode 的 system prompt 补充
- `isPlanCommand(text: string): boolean` — 判断用户输入是否为 /plan
- `isDoCommand(text: string): boolean` — 判断用户输入是否为 /do
- `filterReadOnlyTools(tools: Tool[]): ToolMeta[]` — 过滤出只读工具

**依赖：** Tool 类型

### 模块 F: ChatService 改造（`chat/chat-service.ts`）

**职责：** 保持消息历史管理、会话持久化、取消控制。但 `sendMessage()` 内部改为调用 AgentLoop.run()，自身退化为事件流的消费者和转发者。新增 Plan Mode 状态管理。

**对外接口：** `sendMessage(text): AsyncIterable<AgentEvent>` — 发送用户消息，返回 Agent 事件流

**依赖：** AgentLoop, Provider, ToolRegistry

## 模块交互

```
用户输入
    │
    ▼
ChatService.sendMessage(text)
    │
    ├─ 解析命令：/plan? /do?
    │  └─ 更新 mode 状态
    │
    ├─ 组装参数：
    │  ├─ messages[]     (对话历史)
    │  ├─ provider       (LLMProvider)
    │  ├─ allTools[]     (完整工具列表)
    │  └─ config         (maxRounds, mode, planFilePath)
    │
    ▼
AgentLoop.run(messages, provider, tools, config, signal)
    │
    ┌─────────────────────────────────────┐
    │  while round < maxRounds:           │
    │    │                                │
    │    ├─ 构建 toolMetas (plan mode    │
    │    │  下过滤为只读)                  │
    │    │                                │
    │    ├─ provider.streamChat()         │
    │    │   → StreamCollector            │
    │    │   ├─ yield text 实时 → 界面     │
    │    │   ├─ yield tool_use → 界面     │
    │    │   └─ 内部累积 fullText,        │
    │    │      toolCalls[], usage        │
    │    │                                │
    │    ├─ 判断停止条件                    │
    │    │   ├─ hadError → stopped        │
    │    │   ├─ no toolCalls → done       │
    │    │   └─ signal.aborted → cancel   │
    │    │                                │
    │    ├─ ToolScheduler.schedule()      │
    │    │   ├─ 只读工具 → Promise.all    │
    │    │   └─ 副作用工具 → 串行         │
    │    │                                │
    │    ├─ 检测 unknown_tool              │
    │    │                                │
    │    ├─ 工具结果回灌 messages[]        │
    │    │                                │
    │    └─ round++                       │
    │                                    │
    │  yield stopped(reason)              │
    └─────────────────────────────────────┘
    │
    ▼
ChatService 消费 AgentEvent → 界面
```

## 文件组织

```
src/
├── agent/
│   ├── types.ts              — AgentEvent, StopReason, AgentLoopConfig, StreamResult
│   ├── loop.ts               — AgentLoop 类，ReAct 核心循环
│   ├── stream-collector.ts   — StreamCollector，双重输出收集器
│   ├── tool-scheduler.ts     — ToolScheduler，分批执行策略
│   └── plan-mode.ts          — Plan Mode prompt、命令解析、工具过滤
├── chat/
│   └── chat-service.ts       — [修改] 重构 sendMessage，改为调用 AgentLoop
├── provider/
│   ├── types.ts              — 不变
│   ├── anthropic.ts          — 不变
│   ├── openai.ts             — 不变
│   ├── factory.ts            — 不变
│   └── sse.ts                — 不变
├── tool/
│   ├── types.ts              — 不变
│   ├── registry.ts           — [修改] 新增按安全性过滤方法
│   ├── executor.ts           — 不变
│   └── tools/                — 不变
├── tui/                      — 不变
├── config/                   — [修改] 新增 agentLoop 配置项到 codia.yaml
└── __tests__/
    ├── agent/
    │   ├── loop.test.ts       — AgentLoop 单元测试（mock provider）
    │   ├── stream-collector.test.ts
    │   ├── tool-scheduler.test.ts
    │   └── plan-mode.test.ts
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| Agent Loop 抽成独立模块 | 新建 `agent/` 目录 | ChatService 已经很重，循环逻辑独立可测试、可复用 |
| 事件模型 | 在现有 Chunk 类型上扩展 AgentEvent | 保持与 Provider 层的兼容，减少改动范围 |
| Plan Mode 实现 | Prompt 约束 + 工具列表过滤 | 双保险：prompt 告诉模型不能写，工具列表里直接没有写工具 |
| 工具分批依据 | 只用 `destructive` 标签 | readOnly=true 的一定是 destructive=false，用 destructive 判断更直接 |
| 未知工具停止条件 | 所有请求的工具都不存在才停 | 如果 N 个工具中只有部分不存在但其他的执行成功，让 LLM 从结果中自我纠正 |
| Plan Mode 命令识别 | ChatService 层识别 `/plan` `/do` | AgentLoop 不关心命令格式，只关心 mode 字段 |
| 流式收集器 | 独立类包装 AsyncIterable | 职责单一：转发 + 收集，不掺杂循环判断逻辑 |
| unit test 方案 | mock LLMProvider，注入预设响应 | 不依赖真实 API，可测试停止条件、分批逻辑等核心路径 |
| 工具分批执行顺序 | 只读全并发 + 副用作串行，不保持模型指定的原始顺序 | 模型返回 [read1, write1, read2] 时，read1 和 read2 并发，write1 在后。模型可能期望 read1 → write1 → read2 的顺序，但并发优化优先于顺序保真。如 read2 读到 write1 之前的数据，由 LLM 在下一轮自行调整 |
| 取消时的消息历史 | 取消时当前轮的部分工具结果可能已写入 messages，不回滚 | 简单实现，避免复杂的状态回滚逻辑。用户取消后重新发起对话即可 |
| Plan Mode 无操作 | /do 在非 plan 模式下无操作 | 避免未定义行为，简化状态管理 |
