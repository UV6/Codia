# Codia 基础对话 Plan

## 架构概览

采用四层架构，自上而下：

```
┌──────────────────────────────────────────┐
│  CLI Entry (bin/codia.ts)                 │
│  npm link 后可全局调用                     │
│  职责：读配置 → 创建服务 → 启动 TUI         │
└──────────────┬───────────────────────────┘
               │
┌──────────────▼───────────────────────────┐
│  TUI Layer (src/tui/)                     │
│  Ink 组件树，类似 Claude Code 风格         │
│  - App: 根组件，管理全局状态               │
│  - InputBox: 用户输入区                    │
│  - ChatView: 消息列表 + 流式渲染            │
│  - StatusBar: 模型名 + token 用量          │
└──────────────┬───────────────────────────┘
               │
┌──────────────▼───────────────────────────┐
│  Chat Service (src/chat/)                 │
│  - ChatService: sendMessage() / cancel()  │
│  - HistoryManager: JSONL 读写              │
│  - ContextBuilder: 拼接消息列表            │
└──────────────┬───────────────────────────┘
               │
┌──────────────▼───────────────────────────┐
│  Provider Layer (src/provider/)           │
│  - 接口：streamChat(messages, config)     │
│  - AnthropicProvider: HTTP SSE + thinking │
│  - OpenAIProvider: HTTP SSE              │
│  - factory(config): 根据 protocol 创建     │
└──────────────┬───────────────────────────┘
               │
┌──────────────▼───────────────────────────┐
│  Config (codia.yaml, 仓库根目录)           │
│  - src/config/: 读取、校验 YAML            │
└──────────────────────────────────────────┘
```

**数据流（一次对话请求）：**
1. 用户在 InputBox 输入文本
2. TUI 调用 ChatService.sendMessage(text)
3. ChatService 从 HistoryManager 读历史，拼成完整 messages 列表
4. ChatService 调用 provider.streamChat(messages, config)
5. Provider 发起 HTTP POST（SSE），逐 chunk yield
6. TUI 对每个 chunk 更新 ChatView 流式显示
7. 流结束后 ChatService 将用户消息和 AI 回复写入 JSONL
8. 最后发一个 usage chunk，StatusBar 更新 token 用量

## 核心数据结构

### Message（消息对象，JSONL 每行格式）
```
{
  role: "user" | "assistant" | "system",
  content: string,
  timestamp: string,     // ISO 8601
  usage?: {              // 仅 assistant 消息有
    inputTokens: number,
    outputTokens: number,
    model: string
  },
  thinking?: string      // 仅 Claude extended thinking 时使用
}
```

### ChatConfig（YAML 配置结构）
```
{
  protocol: "anthropic" | "openai",
  model: string,
  baseUrl: string,
  apiKey: string
}
```

### Chunk（流式输出的单元）
```
{
  type: "text" | "thinking" | "usage" | "error" | "done",
  content: string,        // text/thinking 时有内容
  usage?: {               // usage 时有用量信息
    inputTokens: number,
    outputTokens: number,
    model: string
  },
  error?: {               // error 类型时
    code: "auth" | "rate_limit" | "network" | "unknown",
    message: string
  }
}
```

### Provider 接口
```typescript
interface LLMProvider {
  readonly name: string;
  streamChat(
    messages: Message[],
    config: ChatConfig,
    signal: AbortSignal
  ): AsyncIterable<Chunk>;
}
```

## 模块设计

### 模块 A: Config（配置读取）
**职责：** 从 `codia.yaml` 读取并校验配置
**对外接口：**
- `loadConfig(path?: string): ChatConfig` — 加载并校验，失败抛 `ConfigError`
- `ConfigError` 类 — 含 `code: "not_found" | "invalid_format" | "missing_field"`

**依赖：** 无

---

### 模块 B: HistoryManager（对话历史管理）
**职责：** JSONL 文件的读写追加
**对外接口：**
- `loadHistory(filePath: string): Message[]` — 读全部消息
- `appendMessage(filePath: string, msg: Message): void` — 追加一行
- `clearHistory(filePath: string): void` — 清空文件

**依赖：** 无（纯 fs 操作）

---

### 模块 C: ContextBuilder（上下文拼接）
**职责：** 将用户新消息 + 历史消息拼成发给 API 的完整列表
**对外接口：**
- `buildMessages(history: Message[], newMessage: string, systemPrompt: string): Message[]`

**依赖：** Message 类型

---

### 模块 D: Provider Layer（LLM 后端抽象）
**职责：** 统一后端调用，隐藏 Anthropic/OpenAI 差异
**对外接口：**
- `createProvider(config: ChatConfig): LLMProvider` — 工厂函数
- `LLMProvider` 接口（见上文）
- `AnthropicProvider` — 实现 Anthropic Messages API + SSE
- `OpenAIProvider` — 实现 OpenAI Chat Completions API + SSE

**依赖：** `undici`（或内置 `fetch`）做 HTTP + SSE 解析

---

### 模块 E: ChatService（对话核心）
**职责：** 串联历史、上下文、Provider，暴露给 TUI 层
**对外接口：**
- `sendMessage(text: string): AsyncIterable<Chunk>`
- `cancel(): void` — 中断当前流式请求
- `onUsage: (usage) => void` — 用量回调
- `history: Message[]` — 当前会话消息

**依赖：** HistoryManager, ContextBuilder, Provider

---

### 模块 F: TUI（Ink 界面）
**职责：** 终端 UI 渲染与用户交互
**组件：**
- `App` — 根组件，持有 ChatService 实例，管理 `inputState | streamingState`
- `InputBox` — 接收用户输入，按回车提交
- `ChatView` — 渲染消息列表，流式追加文本
- `ThinkingBox` — 折叠/展开显示 thinking 内容
- `StatusBar` — 底部显示模型名 + token 用量
**对外接口：** 无（叶子模块）

**依赖：** ChatService, react, ink

## 模块交互

### 启动流程
```
CLI Entry                    Config                    TUI (App)
  │                            │                        │
  │──loadConfig("codia.yaml")──▶                        │
  │◀───────ChatConfig───────────│                        │
  │                                                      │
  │──new ChatService(config)───▶                         │
  │                                                      │
  │──<App service={svc}/>────────────────────────────────▶
  │                                                      │
  │                                                render()
  │                                              InputBox就绪
```

### 一次对话请求
```
InputBox                 ChatService            HistoryManager    ContextBuilder    Provider(Anthropic)
  │──按回车───────────────▶                       │                 │                 │
  │                      │──loadHistory()────────▶                 │                 │
  │                      │◀───Message[]───────────│                 │                 │
  │                      │                                         │                 │
  │                      │──buildMessages(history, newMsg)────────▶                 │
  │                      │◀───────messages[]───────────────────────│                 │
  │                      │                                                            │
  │                      │──streamChat(messages, config, signal)─────────────────────▶
  │                      │                                                            │
  │◀──────Chunk──────────│◀───────AsyncIterable<Chunk>─────────────────────────────────│
  │  (逐个yield)          │                                                            │
  │                      │                                                            │
  │    ... 持续流式 ...    │                    │                                       │
  │                      │                    │                                       │
  │◀──Chunk{type:"done"}─│◀────────────────────────────────────────────────────────────│
  │                      │                                                            │
  │                      │──appendMessage("user", msg)────────────────▶               │
  │                      │──appendMessage("assistant", msg)────────────▶               │
  │                      │                                                            │
  │   render usage       │                                                            │
  │   InputBox 恢复       │                                                            │
```

### 取消流程
```
 用户按 Ctrl+C
     │
     ▼
InputBox → ChatService.cancel()
              │
              ▼
         AbortController.abort()
              │
              ▼
        Provider 捕获 AbortError
              │
              ▼
        yield { type: "done" }
```

### 错误路径
```
Provider HTTP error
     │
     ▼
yield { type: "error", error: { code, message } }
     │
     ▼
ChatView 显示红色错误信息
InputBox 恢复可输入状态
```

## 文件组织

```
codia/
├── bin/
│   └── codia.ts              — CLI 入口，npm bin 指向这里
├── src/
│   ├── config/
│   │   └── index.ts          — loadConfig() + ConfigError
│   ├── chat/
│   │   ├── chat-service.ts   — ChatService 类
│   │   ├── history.ts        — HistoryManager (JSONL 读写)
│   │   └── context.ts        — ContextBuilder (消息拼接)
│   ├── provider/
│   │   ├── types.ts          — LLMProvider 接口, Chunk, Message 类型
│   │   ├── factory.ts        — createProvider(config)
│   │   ├── anthropic.ts      — AnthropicProvider
│   │   ├── openai.ts         — OpenAIProvider
│   │   └── sse.ts            — SSE 流解析工具函数
│   └── tui/
│       ├── app.tsx           — Ink 根组件
│       ├── input-box.tsx     — 输入区域
│       ├── chat-view.tsx     — 消息列表 + 流式渲染
│       ├── thinking-box.tsx  — thinking 内容折叠展示
│       └── status-bar.tsx    — 底部状态栏
├── codia.yaml                — 默认配置文件
├── package.json
├── tsconfig.json
└── README.md
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 运行时 | Node.js 22+ | 内置 `fetch`（HTTP SSE 无需额外库），原生 ESM |
| TUI 框架 | Ink 5 | React 组件化，支持流式状态更新，社区活跃 |
| 语言 | TypeScript 5.x | 全栈类型安全，tsx 直接执行 .ts 文件 |
| 执行方式 | `tsx` 运行 `.ts` 源文件 | 开发期无需编译，启动快 |
| HTTP 客户端 | 原生 `fetch`（Node.js 22+）| 零依赖，支持 ReadableStream（SSE 解析） |
| SSE 解析 | 自写 `parseSSEStream()` | 逻辑简单（按行 split，截 `data:` 前缀），无需第三方依赖 |
| CLI 二进制 | `package.json` 的 `bin` 字段 + shebang | 标准做法，`npm link` 即用 |
| 对话历史格式 | JSONL | 追加写入高效，崩溃安全，与 LLM API 消息格式一致 |
| 取消机制 | AbortController / AbortSignal | 标准 Web API，fetch 原生支持，Provider 接口传递 signal |
| 包管理 | pnpm | 速度快，磁盘复用 |
