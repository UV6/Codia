# 上下文压缩 Plan

## 架构概览

新增 `src/context/` 模块，包含四个子组件，以中间件形式嵌入 `AgentLoop`：

```
┌─────────────────────────────────────────────────────┐
│  AgentLoop.run                                      │
│                                                     │
│  while (round < maxRounds) {                        │
│    ┌──────────────────────────────────┐             │
│    │ ContextManager.preRequest(msgs)   │ ← 每次 API │
│    │  ├─ TokenEstimator.estimate()    │   请求前    │
│    │  └─ 若超阈值 → HeavyCompressor   │             │
│    └──────────────────────────────────┘             │
│    provider.streamChat(messages)                     │
│    ...                                              │
│    toolResults = scheduler.schedule(...)             │
│    ┌──────────────────────────────────┐             │
│    │ ContextManager.compressResults()  │ ← 工具执行 │
│    │  ├─ F1: 逐个 >50K → 存盘+预览    │   后        │
│    │  └─ F2: 合并 >200K → 存盘+预览   │             │
│    └──────────────────────────────────┘             │
│    messages.push(combinedMsg)                        │
│  }                                                  │
└─────────────────────────────────────────────────────┘
```

四个子组件：

- **TokenEstimator** — token 近似估算。维护上次 API 返回的 `inputTokens` 锚点 + 增量消息字符数 ÷ 4
- **LightCompressor** — 轻量预防（F1-F3）。字符串操作 + 文件 I/O，超大工具结果存盘替换为预览
- **HeavyCompressor** — 重量兜底（F4-F10）。调 LLM 生成摘要，管理熔断计数
- **ContextStore** — 持久化。被截断的工具结果和摘要写入 `~/.Codia/context/`

入口统一为 **ContextManager**，对外暴露两个方法：`preRequest(messages, mode)`（重量检查）和 `compressToolResults(results)`（轻量检查）。

`/compress` 命令由 `ChatService` 解析后直接调用 `ContextManager.preRequest(messages, "manual")`。

## 核心数据结构

### CompressEvent（src/context/types.ts）

```typescript
interface CompressEvent {
  type: "compress";
  action: "tool_result_stored" | "manual_compress" | "auto_compress" | "compress_failed";
  message?: string;
  path?: string;       // 存盘文件路径
  savedTokens?: number; // 节省的 token 估算数
  summary?: string;     // 摘要内容预览（前 200 字）
}
```

### TokenAnchor（src/context/types.ts）

```typescript
interface TokenAnchor {
  inputTokens: number;       // 上次 API 返回的 inputTokens
  messageIndex: number;      // 该锚点对应的 messages 数组长度
}
```

### ContextManager

```typescript
class ContextManager {
  constructor(
    provider: LLMProvider,
    chatConfig: ChatConfig,
    sessionId: string,
    onEvent?: (event: CompressEvent) => void,
  );

  // preRequest —— API 请求前调用（F4 自动触发入口）
  async preRequest(messages: Message[], mode: "auto" | "manual", signal?: AbortSignal): Promise<Message[]>;

  // compressToolResults —— 工具执行后调用（F1, F2 入口）
  compressToolResults(results: ToolResult[], messages: Message[]): ToolResult[];

  // setAnchor —— 每次 API 返回后更新 token 估算锚点（F11）
  setAnchor(usage: { inputTokens: number }, messageCount: number): void;
}
```

### TokenEstimator

```typescript
class TokenEstimator {
  setAnchor(usage: { inputTokens: number }, messageCount: number): void;
  estimate(messages: Message[]): number;
  estimateTokens(text: string): number; // 字符数 ÷ 4
}
```

### LightCompressor

```typescript
function compressResult(result: ToolResult): CompressedResult;
function compressBatch(results: ToolResult[]): ToolResult[];

interface CompressedResult {
  result: ToolResult;     // 压缩后的结果（预览+路径 或 原始完整内容）
  stored: boolean;        // 是否已存盘
  filePath?: string;      // 存盘路径
}
```

### HeavyCompressor

```typescript
class HeavyCompressor {
  private failureCount: number;

  async compress(
    messages: Message[],
    provider: LLMProvider,
    config: ChatConfig,
    signal: AbortSignal,
    keepTokens: number,       // 保留窗口大小，~10K
    keepMinMessages: number,  // 至少保留 5 条
  ): Promise<{
    messages: Message[];
    savedTokens: number;
    summary: string;
  }>;

  isFused(): boolean;  // 是否已熔断
}
```

### ContextStore（纯函数）

```typescript
function saveResult(sessionId: string, content: string, meta: { type: string; timestamp: string }): string;
function loadResult(filePath: string): string;
```

## 模块设计

### ContextManager

**职责：** 统一对外入口，协调 TokenEstimator、LightCompressor、HeavyCompressor 和 ContextStore。暴露 `preRequest` 和 `compressToolResults` 两个方法。

**对外接口：**
- `preRequest(messages, mode, signal?)` — 重量压缩检查入口
- `compressToolResults(results, messages)` — 轻量压缩入口
- `setAnchor(usage, messageCount)` — 委托给 TokenEstimator

**依赖：** TokenEstimator（状态）、HeavyCompressor（状态）、LightCompressor（纯函数）、ContextStore（纯函数）

### TokenEstimator

**职责：** 管理 token 估算锚点，提供消息列表的 token 总量估算。估算时跳过 `role: "system"` 的消息（system prompt 为固定开销，不参与压缩决策）。

**对外接口：**
- `setAnchor(usage, messageCount)` — 在每次 API 调用返回后更新锚点
- `estimate(messages)` — 返回估算的总 token 数

**依赖：** 无

### LightCompressor

**职责：** 按 F1/F2/F3 规则处理工具结果。单结果超 50K → 存盘替换；批量合并超 200K 字符 → 排序后依次存盘替换；不碰用户消息。compressResult 中的存盘操作为副作用调用（ContextStore.saveResult），非纯函数。

**对外接口：**
- `compressResult(result)` — 单个结果处理
- `compressBatch(results)` — 批量结果处理（排序+存盘替换）

**依赖：** ContextStore.saveResult

### HeavyCompressor

**职责：** 管理摘要生成流程。生成禁止工具调用的 prompt、要求 `<draft>`→`<summary>` 格式、调用 LLM、取摘要段丢弃草稿段、插入边界消息、管理失败计数。

**对外接口：**
- `compress(messages, provider, config, signal, keepTokens, keepMinMessages)` — 执行摘要
- `isFused()` — 是否已熔断

**依赖：** LLMProvider、ContextStore.saveResult

**多次压缩行为：** 第二次及后续压缩触发时，之前的摘要消息作为普通消息参与 `splitMessages` 划分。若旧摘要落在 `old` 区间则被新一轮摘要覆盖（旧摘要不单独保留），若落在 `recent` 区间则保留原文。

### ContextStore

**职责：** 纯文件 I/O。将截断的工具结果或摘要写入 `~/.Codia/context/<sessionId>/` 目录。

**对外接口：**
- `saveResult(sessionId, content, meta)` — 写入文件，返回文件路径
- `loadResult(filePath)` — 读取文件

**依赖：** Node.js fs

## 模块交互

### 调用链（自动压缩）

```
ChatService.sendMessage
  → AgentLoop.run
    → [每轮循环]
      1. ContextManager.preRequest(messages, "auto")
         → TokenEstimator.estimate(messages)
         → 若 ≥ 187K:
           → HeavyCompressor.compress(messages, ...)
             → 确定保留点（从 tail 往回数 ~10K token 或 ≥5 条）
             → 构建摘要 prompt（无工具、要求 <draft>/<summary> 格式）
             → provider.streamChat(摘要请求, { tools: undefined })
             → 解析流，提取 <summary> 内容，丢弃 <draft>
             → ContextStore.saveResult(sessionId, summary)
             → 构造新 messages：[...摘要消息(role: "assistant"), 边界消息(role: "user"), ...保留的近期原文]
             → 边界消息紧跟摘要消息之后、保留原文之前
             → 失败 → failureCount++，保留原始 messages
             → 若 failureCount ≥ 3 → 跳过后续压缩
           → 否则: 跳过，返回原始 messages
      2. provider.streamChat(messages)       ← 实际 API 调用
      3. TokenEstimator.setAnchor(usage, n)  ← 锚定 usage
      4. ToolScheduler.schedule(toolCalls)
      5. ContextManager.compressToolResults(results, messages)
         → 逐个 compressResult(result)      ← F1 检查
         → compressBatch(processed)          ← F2 检查
         → 跳过已有的边界消息（不压缩）
      6. 合并结果 → messages.push(compressedMsg)
```

### `/compress` 手动触发

```
ChatService.sendMessage → 识别 /compress
  → 调用 ContextManager.preRequest(messages, "manual")
    → 不检查阈值，直接启动压缩
    → 保留余量 3K（用于确定保留窗口大小）
    → yield CompressEvent 给 TUI
```

### 数据流

```
messages ──→ preRequest ──→ 摘要替换老旧消息 ──→ 新 messages
               │
               │(compressToolResults)
               │
               └──→ 大结果存盘 ──→ 预览+路径替换
```

## 文件组织

```
src/context/
├── types.ts              — CompressEvent, TokenAnchor, CompressedResult 类型
├── manager.ts            — ContextManager，统一对外入口
├── token-estimator.ts    — TokenEstimator，近似估算
├── light-compressor.ts   — F1-F3 轻量预防
├── heavy-compressor.ts   — F4-F10 重量兜底，含摘要 prompt 和熔断
├── store.ts              — ContextStore 持久化
└── index.ts              — 导出

src/agent/loop.ts         — 修改：注入 ContextManager，在 streamChat 前和工具结果合并前调用；压缩事件 yield
src/agent/types.ts        — 修改：AgentEvent 联合类型增加 CompressEvent
src/chat/chat-service.ts  — 修改：解析 /compress 命令，初始化 ContextManager 并传入 AgentLoop
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 嵌入位置 | `AgentLoop.run` 内部 | 直接访问 messages 数组、provider 实例和工具结果，最自然的切入点 |
| 摘要用相同模型 | 复用当前配置的 provider/model | spec 明确不做模型选择优化；摘要请求不带工具，成本略低于常规 API 调用 |
| 摘要请求不做 tool_use | 构造不带 `tools` 参数的 API 请求 | spec 要求禁止模型调工具，最简单的方式是从请求中移除 tools 数组 |
| 锚点估算策略 | 每次 API 返回后更新锚点、增量按字符数估算 | 锚点（API 真实计数值）是最高精度的参考点，增量用字符数估算误差可控且实现成本低 |
| 上下文文件存储 | `~/.Codia/context/<session-id>/` | 与现有 `~/.Codia/sessions/` 平级，按会话隔离 |
| `/compress` 命令 | 复用 `ChatService` 的命令解析模式 | 已有 `/plan`、`/default` 等命令解析，统一风格 |
| 压缩事件 | 新增 `compress` 事件类型 yield 给上层 | 沿袭现有 `tool_result`、`round_start` 等事件模式 |
| 保留窗口计算 | 从 tail 往回逐条累加 token 估算值 | O(n) 单次遍历，简单可靠 |
| ContextManager 注入方式 | 通过 AgentLoop 构造函数参数传入 | 避免 AgentLoop 直接依赖 provider 创建细节，保持可测试性 |
