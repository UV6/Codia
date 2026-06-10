# Codia 基础对话 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `package.json` | 项目元信息、依赖、bin 入口、scripts |
| 新建 | `tsconfig.json` | TypeScript 编译配置 |
| 新建 | `vitest.config.ts` | 测试框架配置 |
| 新建 | `codia.yaml` | 默认配置文件 |
| 新建 | `bin/codia.ts` | CLI 入口，shebang |
| 新建 | `src/config/index.ts` | loadConfig() + ConfigError |
| 新建 | `src/provider/types.ts` | Message, Chunk, ChatConfig, LLMProvider 接口 |
| 新建 | `src/provider/sse.ts` | parseSSEStream() |
| 新建 | `src/provider/anthropic.ts` | AnthropicProvider |
| 新建 | `src/provider/openai.ts` | OpenAIProvider |
| 新建 | `src/provider/factory.ts` | createProvider() |
| 新建 | `src/chat/history.ts` | HistoryManager (JSONL 读写) |
| 新建 | `src/chat/context.ts` | ContextBuilder (消息拼接) |
| 新建 | `src/chat/chat-service.ts` | ChatService |
| 新建 | `src/tui/app.tsx` | Ink 根组件，含 SIGINT 处理 |
| 新建 | `src/tui/input-box.tsx` | 输入区域，流式中禁用 |
| 新建 | `src/tui/chat-view.tsx` | 消息列表 + 流式渲染 + 错误展示 |
| 新建 | `src/tui/thinking-box.tsx` | thinking 内容折叠展示 |
| 新建 | `src/tui/status-bar.tsx` | 底部状态栏 |
| 新建 | `src/__tests__/` | 单元测试目录 |

## T1: 项目骨架搭建

**文件：** `package.json`, `tsconfig.json`, `.gitignore`
**依赖：** 无
**步骤：**
1. `pnpm init`，设置 name 为 `codia`
2. 配置 `bin` 字段 `{ "codia": "./bin/codia.ts" }`
3. 配置 scripts：`dev`（tsx bin/codia.ts）、`build`（tsc）、`test`（vitest）、`lint`（如有）
4. 安装依赖: `ink@5`, `react`, `yaml`（运行时）；`tsx`, `typescript`, `@types/react`, `vitest`（dev）
5. 创建 `tsconfig.json`：module=NodeNext, jsx=react-jsx, strict=true, target=ES2022
6. 创建 `.gitignore`（node_modules, dist, .history.jsonl, *.log）

**验证：** `pnpm install` 无报错，`tsc --noEmit` 提示无输入文件（正常，下一步才有）

## T2: 类型定义

**文件：** `src/provider/types.ts`
**依赖：** 无
**步骤：**
1. 定义 `ChatConfig` 类型：protocol（"anthropic" | "openai"）, model, baseUrl, apiKey
2. 定义 `Message` 类型：role（"user" | "assistant" | "system"）, content, timestamp, usage?, thinking?
3. 定义 `Chunk` 类型：type 联合类型（"text" | "thinking" | "usage" | "error" | "done"），每个 type 对应的额外字段
4. 定义 `LLMProvider` 接口：`name: string` + `streamChat(messages: Message[], config: ChatConfig, signal: AbortSignal): AsyncIterable<Chunk>`

**验证：** `tsc --noEmit` 无类型错误

## T3: 测试框架搭建

**文件：** `vitest.config.ts`, `src/__tests__/`
**依赖：** T2
**步骤：**
1. 创建 `vitest.config.ts`，配置 ts 路径解析
2. 创建 `src/__tests__/` 目录
3. 写一个冒烟测试：验证 Message 类型可正确创建对象

**验证：** `pnpm test` 运行通过

## T4: 配置读取

**文件：** `src/config/index.ts`
**依赖：** T2（ChatConfig 类型）
**步骤：**
1. 实现 `ConfigError` 类，继承 Error，含 `code` 字段（"not_found" | "invalid_format" | "missing_field"）
2. 实现 `loadConfig(path?: string): ChatConfig`：
   - 默认读 `./codia.yaml`
   - 文件不存在抛 ConfigError("not_found")
   - YAML 解析失败抛 ConfigError("invalid_format")
   - 四个必填字段缺失任一抛 ConfigError("missing_field")
3. protocol 值校验：只接受 "anthropic" | "openai"

**验证：** `tsx -e "import { loadConfig } from './src/config'; console.log(loadConfig('./codia.yaml'))"` 输出配置对象；缺失文件时抛 ConfigError

## T5: SSE 解析工具

**文件：** `src/provider/sse.ts`
**依赖：** T2（Chunk 类型）
**步骤：**
1. 实现 `parseSSEStream(body: ReadableStream, abortSignal: AbortSignal): AsyncGenerator<Chunk>`
2. 用 `TextDecoderStream` 解码字节流
3. 按 `\n\n` 分割 SSE 事件
4. 每行截 `data: ` 前缀，跳过注释行（`:` 开头）
5. `[DONE]` 时 yield `{ type: "done" }`
6. JSON parse 内容，按字段映射到 Chunk 类型
7. abortSignal 触发时停止迭代（try-catch AbortError）

**验证：** `pnpm test` — 用 mock ReadableStream 写测试：单事件、多事件、`[DONE]`、错误事件、中断信号

## T6a: Anthropic Provider — 请求构建

**文件：** `src/provider/anthropic.ts`
**依赖：** T2, T5
**步骤：**
1. 实现 `AnthropicProvider implements LLMProvider`，name = "anthropic"
2. 实现内部辅助函数 `buildRequestBody(messages: Message[], config: ChatConfig)`：
   - 构建请求体：`{ model, max_tokens: 4096, messages, stream: true }`
   - messages 中 system role 提为顶层 `system` 字段
   - 从 config 读 `thinking` 子字段配置 extended thinking
3. 构建 HTTP 请求：POST `${baseUrl}/v1/messages`，headers 含 `x-api-key`、`anthropic-version: 2023-06-01`、`content-type`

**验证：** `tsx -e "import { AnthropicProvider } from './src/provider/anthropic'; console.log(new AnthropicProvider().name)"`

## T6b: Anthropic Provider — 流式处理

**文件：** `src/provider/anthropic.ts`（在 T6a 基础上追加）
**依赖：** T6a
**步骤：**
1. 实现 `streamChat()` — 发送请求，拿到 `response.body`（ReadableStream），传给 `parseSSEStream()`
2. SSE 事件映射：
   - `content_block_delta`（delta.type === "text_delta"）→ yield `{ type: "text", content }`
   - `content_block_delta`（delta.type === "thinking_delta"）→ yield `{ type: "thinking", content }`
   - `message_delta`（含 usage）→ yield `{ type: "usage", usage }`
   - `message_stop` → yield `{ type: "done" }`
3. HTTP 错误映射：401→`{ type: "error", error: { code: "auth" } }`，429→rate_limit，其他→unknown
4. fetch 网络异常 → `{ type: "error", error: { code: "network" } }`
5. AbortSignal 传入 fetch，中断时 yield `{ type: "done" }`

**验证：** 后续集成测试时验证（需要 API key）

## T7a: OpenAI Provider — 请求构建

**文件：** `src/provider/openai.ts`
**依赖：** T2, T5
**步骤：**
1. 实现 `OpenAIProvider implements LLMProvider`，name = "openai"
2. 实现内部辅助函数 `buildRequestBody()`：
   - 构建请求体：`{ model, messages, stream: true }`
   - messages 直接传入（OpenAI 原生支持 system role）
3. 构建 HTTP 请求：POST `${baseUrl}/v1/chat/completions`，headers 含 `Authorization: Bearer ${apiKey}`、`content-type`

**验证：** 同 T6a，确认 name 为 "openai"

## T7b: OpenAI Provider — 流式处理

**文件：** `src/provider/openai.ts`（在 T7a 基础上追加）
**依赖：** T7a
**步骤：**
1. 实现 `streamChat()` — 发送请求，`response.body` 传给 `parseSSEStream()`
2. SSE 事件映射：
   - `choices[0].delta.content` 非空 → yield `{ type: "text", content }`
   - `choices[0].finish_reason === "stop"` → yield `{ type: "done" }`
   - 最后一个 chunk 含 `usage` → yield `{ type: "usage", usage }`
3. HTTP 错误映射同 T6b
4. AbortSignal 处理同 T6b

**验证：** 后续集成测试时验证（需要 API key）

## T8: Provider 工厂

**文件：** `src/provider/factory.ts`
**依赖：** T6a, T7a
**步骤：**
1. 实现 `createProvider(config: ChatConfig): LLMProvider`
2. 按 `config.protocol` 分发：anthropic → new AnthropicProvider()，openai → new OpenAIProvider()
3. 未知 protocol 抛 Error

**验证：** `tsx -e "import { createProvider } from './src/provider/factory'; const p = createProvider({protocol:'openai',model:'gpt-4',baseUrl:'https://api.openai.com',apiKey:'test'}); console.log(p.name)"` 输出 "openai"

## T9: HistoryManager

**文件：** `src/chat/history.ts`
**依赖：** T2（Message 类型）
**步骤：**
1. 实现 `loadHistory(filePath: string): Message[]`：
   - 文件不存在返回 `[]`
   - 逐行读 JSONL，每行 JSON.parse
   - 解析失败的行跳过并 console.warn
2. 实现 `appendMessage(filePath: string, msg: Message): void`：
   - `fs.appendFileSync(filePath, JSON.stringify(msg) + '\n')`

**验证：** `pnpm test` — 写几条消息，read 回来；空文件返回 []；损坏行跳过

## T10: ContextBuilder

**文件：** `src/chat/context.ts`
**依赖：** T2（Message 类型）
**步骤：**
1. 实现 `buildMessages(history: Message[], newUserMsg: string, systemPrompt: string): Message[]`
2. 输出格式：`[{ role: "system", content: systemPrompt }, ...history（去除 thinking 字段）, { role: "user", content: newUserMsg, timestamp: new Date().toISOString() }]`
3. systemPrompt 内置默认值：`"You are Codia, a helpful CLI AI assistant. Answer concisely."`

**验证：** `pnpm test` — 空历史 + 新消息 → [system, user]；有历史 → [system, ...history, user]

## T11a: ChatService — 初始化

**文件：** `src/chat/chat-service.ts`
**依赖：** T2, T4, T8, T9
**步骤：**
1. 实现 ChatService 类：
   - 构造器：`constructor(config: ChatConfig, historyPath?: string)`
   - 默认 `historyPath = "./.codia-history.jsonl"`
   - 构造时调用 `createProvider(config)` 注入 provider
   - 构造时调用 `loadHistory(historyPath)` 加载历史
   - 暴露 `history` getter
2. 暴露 `onUsage` 回调属性：`(usage: { inputTokens: number, outputTokens: number, model: string }) => void`

**验证：** `tsx -e` 创建实例，检查 history 和 provider 是否正确注入

## T11b: ChatService — 消息收发

**文件：** `src/chat/chat-service.ts`（追加）
**依赖：** T11a, T10, T9
**步骤：**
1. 实现 `sendMessage(text: string): AsyncIterable<Chunk>`：
   - 创建新的 AbortController
   - 调用 `buildMessages(history, text, systemPrompt)`
   - 调用 `provider.streamChat(messages, config, signal)`
   - 收集所有 text chunk 内容拼接为完整回复
   - 流结束后 `appendMessage` 写 user 消息和 assistant 消息
   - usage chunk 触发 `onUsage` 回调
2. 错误 chunk 不写入历史，透传给调用方

**验证：** 后续 T12-T16 集成时端到端验证

## T11c: ChatService — 取消与错误

**文件：** `src/chat/chat-service.ts`（追加）
**依赖：** T11b
**步骤：**
1. 实现 `cancel()`：调用 `AbortController.abort()`
2. 捕获 AbortError，已接收的内容仍写入历史（标记为被中断的 assistant 消息）
3. Provider 返回的 error chunk 透传，TUI 展示红色错误

**验证：** 集成测试中按 Ctrl+C 验证

## T12: TUI — InputBox

**文件：** `src/tui/input-box.tsx`
**依赖：** T2（Message 类型概念），Ink 的 `useInput`
**步骤：**
1. Props：`onSubmit: (text: string) => void`, `disabled: boolean`
2. 用 `<Text>` 显示前缀 `Codia > `，后跟 `<TextInput>`
3. 按回车触发 `onSubmit`
4. `disabled=true` 时隐藏 TextInput，显示 "..."
5. 错误状态（`error?: string`）时显示红色错误提示

**验证：** 在 App 中渲染，输入文本回车，确认 onSubmit 被调用

## T13: TUI — ChatView

**文件：** `src/tui/chat-view.tsx`
**依赖：** T2（Message 类型），Ink `<Box>`, `<Text>`
**步骤：**
1. Props：`messages: Message[]`, `streamingContent?: string`
2. 遍历 messages，每条渲染为消息块：
   - user 消息：默认色，前缀 `>`
   - assistant 消息：绿色
3. 最新 assistant 消息下方 append streamingContent（逐字出现）
4. 每条消息显示时间戳（HH:MM:SS）
5. 错误消息（role="system" 且 error 标记）红色渲染

**验证：** 传入 mock 消息数组，确认渲染正确

## T14: TUI — ThinkingBox

**文件：** `src/tui/thinking-box.tsx`
**依赖：** Ink `<Box>`, `<Text>`
**步骤：**
1. Props：`thinking: string`, `collapsed: boolean`, `onToggle: () => void`
2. 灰色/斜体展示 thinking 内容
3. 折叠/展开：按 `Ctrl+T` 切换，折叠时显示 `<Thinking... (Ctrl+T 展开)>`
4. 流式中实时追加 thinking 文本

**验证：** 传入 thinking 文本，测试折叠/展开行为

## T15: TUI — StatusBar

**文件：** `src/tui/status-bar.tsx`
**依赖：** Ink `<Box>`, `<Text>`
**步骤：**
1. Props：`model: string`, `usage?: { inputTokens: number, outputTokens: number }`
2. 底部固定行，灰色背景
3. 左侧显示 `Model: ${model}`
4. 右侧显示 `in:${inputTokens} out:${outputTokens}`（无 usage 时隐藏）
5. 流式中显示 `...` 直到 usage chunk 到达

**验证：** 传入 model 和 usage，确认渲染在底部

## T16: TUI — App 根组件

**文件：** `src/tui/app.tsx`
**依赖：** T11a-c（ChatService），T12-T15
**步骤：**
1. 用 `useState` 管理：`messages: Message[]`, `streaming: { content, thinking } | null`, `thinkingCollapsed: boolean`, `usage`, `error`
2. Props：`service: ChatService`
3. 启动时从 `service.history` 加载已有消息
4. `handleSubmit(text)`：
   - 清空 error、streaming 状态
   - 遍历 `service.sendMessage(text)` 的 AsyncIterable
   - text chunk → 更新 streaming.content
   - thinking chunk → 更新 streaming.thinking
   - usage chunk → 更新 usage
   - error chunk → 设置 error 状态
   - done → 将 streaming 内容转为 Message，追加到 messages
5. Ctrl+C 处理：`useInput` 捕获，调 `service.cancel()`
6. SIGINT 处理：`useApp` 的 `exit` 中确保调用过 cancel（已发出的请求不丢历史）
7. 组合子组件：InputBox, ChatView, ThinkingBox, StatusBar

**验证：** 启动 TUI，输入消息，观察流式渲染

## T17: CLI 入口

**文件：** `bin/codia.ts`
**依赖：** T4, T11, T16
**步骤：**
1. Shebang：`#!/usr/bin/env -S tsx`
2. 调用 `loadConfig()` 加载配置
3. 配置错误时 `console.error("未找到 codia.yaml ...")` + `process.exit(1)`
4. 创建 `ChatService` 实例
5. `render(<App service={svc} />)` 启动 TUI
6. 进程退出时（`process.on('exit')`）确保终端状态恢复

**验证：** `./bin/codia.ts` 启动，进入 TUI 界面

## T18: 默认配置文件

**文件：** `codia.yaml`
**依赖：** T4（配置格式已确定）
**步骤：**
1. 创建模板配置文件，写清注释
```yaml
# Codia LLM 配置
# protocol: 后端协议，支持 anthropic | openai
protocol: anthropic
# model: 模型名称
model: claude-sonnet-4-6-20250514
# base_url: API 请求地址
base_url: https://api.anthropic.com
# api_key: 你的 API 密钥
api_key: YOUR_API_KEY_HERE
```

**验证：** `tsx -e "import { loadConfig } from './src/config'; console.log(loadConfig('./codia.yaml'))"` 正确输出

## 执行顺序

```
T1 → T2 → T3
          ↓
         T4 ────→ T5
          ↓       ↓
          ├──→ T6a → T6b ──┐
          │                 ├──→ T8 → T9 → T10 → T11a → T11b → T11c
          └──→ T7a → T7b ──┘                                    │
                                                                 ├──→ T16 → T17
                    T12 ────────────────────────────────────────┤
                    T13 ────────────────────────────────────────┤
                    T14 ────────────────────────────────────────┘
                    T15 ──→（可并行，需等 T2 类型就绪）

T18（在 T4 后即可并行，建议 T10 之后做以了解完整配置需求）
```

共 24 个任务。
