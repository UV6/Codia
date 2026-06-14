# MCP 客户端 Plan

## 架构概览

新增 `src/mcp/` 子包，内含 5 个模块，形成一条从上到下的调用链：

```
配置合并（config.ts）
    ↓
连接管理器（manager.ts）
    ↓ 为每个 Server 创建
MCP 客户端（client.ts）
    ↓ 底层通信依赖
JSON-RPC 处理（json-rpc.ts）← 传输层（transport.ts）
    ↓ 工具注册
适配器（adapter.ts）→ ToolRegistry
```

- **config.ts**：扩展现有 `src/config/index.ts`，新增 `mcp_servers` 配置段的读取与两层合并逻辑
- **types.ts**：JSON-RPC 2.0 消息类型、MCP 协议类型、配置类型
- **transport.ts**：Transport 接口 + StdioTransport / HttpTransport 两个实现
- **json-rpc.ts**：JSON-RPC 消息的序列化/反序列化、请求-响应按 id 异步配对
- **client.ts**：单个 MCP Server 的完整会话管理（握手 → 列工具 → 调工具）
- **adapter.ts**：`McpToolAdapter` 实现 `Tool` 接口，把远端工具包装为本地 Tool
- **manager.ts**：`ConnectionManager` 统一管理所有 Server 的连接与生命周期

## 核心数据结构

### McpServerConfig（配置层）
```typescript
interface McpServerConfig {
  type: "stdio" | "http";
  // stdio 专用
  command?: string;
  args?: string[];
  env?: Record<string, string>;  // 值支持 ${VAR} 展开
  // http 专用
  url?: string;
  headers?: Record<string, string>;  // 值支持 ${VAR} 展开
}
```

### McpConfig（配置层）
```typescript
interface McpConfig {
  servers: Record<string, McpServerConfig>;  // key = Server 名
}
```

### JsonRpcMessage（协议层）
```typescript
type JsonRpcMessage =
  | { jsonrpc: "2.0"; id: number | string; method: string; params?: unknown }  // Request
  | ({ jsonrpc: "2.0"; id: number | string; } & ({ result: unknown; error?: never } | { result?: never; error: JsonRpcError }))  // Response — 互斥
  | { jsonrpc: "2.0"; method: string; params?: unknown };  // Notification（无 id）

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}
```

### MCP 协议类型（协议层）
```typescript
// 初始化
interface InitializeResult {
  protocolVersion: string;
  capabilities: { tools?: {} };  // 只关心 tools 能力
  serverInfo: { name: string; version: string };
}

// 工具发现
interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: ToolInputSchema;
}

// 工具调用
interface CallToolResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}
```

### Transport（传输层）
```typescript
interface Transport {
  send(message: JsonRpcMessage): Promise<void>;
  onMessage: ((msg: JsonRpcMessage) => void) | null;
  close(): Promise<void>;
}
```

### McpClient（会话层）
```typescript
class McpClient {
  readonly serverName: string;
  get connected(): boolean;
  connect(): Promise<void>;          // 创建 Transport + 初始化握手
  listTools(): Promise<McpToolDef[]>;  // tools/list
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;  // tools/call
  disconnect(): Promise<void>;       // 关闭 Transport
}
```

### McpToolAdapter（适配层，实现 Tool）
```typescript
class McpToolAdapter implements Tool {
  readonly name: string;           // `${serverName}_${toolName}`
  readonly description: string;
  readonly type: "search";
  readonly readOnly: boolean;      // 默认 false（外部工具无法判断只读性）
  readonly destructive: boolean;   // 默认 true（保守原则：未知副作用按串行安全处理）
  readonly inputSchema: ToolInputSchema;
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
```

## 模块设计

### 1. mcptypes — 协议类型

**文件：** `src/mcp/types.ts`

**职责：** 定义所有 JSON-RPC 2.0 和 MCP 协议层类型。

**对外接口：**
- `JsonRpcMessage`、`JsonRpcError` — JSON-RPC 消息类型
- `InitializeResult`、`McpToolDef`、`CallToolResult` — MCP 协议类型
- `McpServerConfig`、`McpConfig` — 配置类型

**依赖：** `src/tool/types.ts` 中的 `ToolInputSchema`

### 2. config — 配置读取与合并

**文件：** 修改 `src/config/index.ts` + 新增 `src/mcp/config.ts`

**职责：**
1. 扩展 `AppConfig` 接口，新增 `mcp?: { servers: Record<string, McpServerConfig> }` 段
2. 支持从用户级和项目级 YAML 分别加载，深度合并 `mcp_servers`
3. 校验每个 Server 配置的必填字段（stdio 必有 command，http 必有 url）；Server name 不允许含下划线
4. **统一在此处执行 `${VAR}` 环境变量展开**——Transport 层接收已展开的最终值，不自行展开

**对外接口：** `loadMcpConfig(userConfigPath?: string, projectConfigPath?: string): McpConfig`
- `userConfigPath` 默认 `~/.Codia/Codia.yml`
- `projectConfigPath` 默认 `process.cwd()/.codia/config.yml`

**依赖：** `src/config/index.ts` 的 `loadAppConfig`、yaml 解析

### 3. transport — 传输层

**文件：** `src/mcp/transport.ts`

**职责：** 定义 `Transport` 接口并提供两种实现。

**StdioTransport：**
- `spawn(config.command, config.args, { env })` 启动子进程
- stdin 写入 JSON-RPC 消息（每行一条，以 `\n` 分隔）
- stdout 逐行读取 JSON-RPC 消息，回调 `onMessage`
- `close()` 发 `kill()` 终止进程

**HttpTransport：**
- POST 发送 JSON-RPC 消息，携带配置的 headers
- 响应体：如果是普通 JSON，直接解析为 JsonRpcMessage；如果 `Content-Type: text/event-stream`，按 SSE 流式解析
- `close()` 为空实现（HTTP 无持久连接）

**对外接口：** `Transport` 接口（send、onMessage、close）

**依赖：** `node:child_process`（spawn）、`fetch`（HTTP）

### 4. json-rpc — 消息编排

**文件：** `src/mcp/json-rpc.ts`

**职责：**
1. 消息序列化/反序列化（`serialize` / `deserialize`）
2. 自动生成递增 id（`requestId`）
3. 请求-响应异步配对：`sendRequest(method, params)` 返回 Promise，内部用 `Map<id, { resolve, reject }>` 挂载等待回调，收到同 id 的 response 时 resolve
4. `sendNotification(method, params)` 直接发送，不等响应
5. 超时处理：30 秒未收到响应则 reject

**对外接口：** `sendRequest(method, params): Promise<unknown>`、`sendNotification(method, params): Promise<void>`

**依赖：** `Transport` 接口

### 5. client — MCP 客户端

**文件：** `src/mcp/client.ts`

**职责：** 单个 MCP Server 的完整会话管理。

**生命周期：**
1. `connect()` → 创建 Transport（stdio 或 http）→ 初始化握手（initialize → initialized 通知）→ 获取工具列表
2. `listTools()` → 发 tools/list 请求，返回 `McpToolDef[]`，缓存结果
3. `callTool(name, args)` → 发 tools/call 请求，返回 `CallToolResult`
4. `disconnect()` → 关闭 Transport

**状态管理：** 三种状态 `"disconnected" | "connected" | "error"`

**对外接口：** `McpClient` 类（connect、listTools、callTool、disconnect）

**依赖：** `json-rpc.ts`、`transport.ts`、`types.ts`

### 6. adapter — 工具适配器

**文件：** `src/mcp/adapter.ts`

**职责：** 将 `McpToolDef` 包装为 Codia 的 `Tool` 接口。

**关键逻辑：**
- `name` → `"${serverName}_${toolName}"`
- `description` → 直接透传，无 description 时用 `"${serverName} 提供的工具"`
- `type` → 固定 `"search"`
- `readOnly` → 默认 `false`
- `destructive` → 默认 `true`（保守原则：MCP 工具副作用未知，确保 ToolScheduler 串行执行它们）
- `inputSchema` → 直接透传 `McpToolDef.inputSchema`
- `execute()` → 调用 `client.callTool(name, params)`，检查 `callResult.isError` 设置 `ToolResult.status`，将 `CallToolResult.content` 拼接为字符串，包装为 `ToolResult`
- **已知限制（v1）：** `AbortSignal` 不转发给 MCP 调用——context.signal 在本次迭代中被忽略

**对外接口：** `createAdapter(serverName, toolDef, client): Tool`

**依赖：** `src/tool/types.ts` 的 `Tool`、`ToolResult`

### 7. manager — 连接管理器

**文件：** `src/mcp/manager.ts`

**职责：** 管理全部 MCP Server 的连接和生命周期。

**流程：**
1. `connectAll(config)` → 并行调用每个 Server 的 `connect → listTools → createAdapter → register`
2. 一个 Server 失败不影响其他——用 `Promise.allSettled` 收集结果
3. `disconnectAll()` → 依次断开所有连接
4. 每次注册前检查命名冲突（已注册的工具名和待注册的 MCP 工具名不能重叠），冲突时报错让用户改名

**对外接口：** `ConnectionManager` 类（connectAll、disconnectAll）

**依赖：** `McpClient`、`McpToolAdapter`、`ToolRegistry`

## 模块交互

### 启动流程

```
用户启动 Codia
    │
    ▼
tui/app.tsx
    │
    ├─ 1. new ChatService(config, ...)  // 构造函数同步：注册 6 个核心工具 + 构建 prompt
    ├─ 2. await chatService.init()      // 异步初始化：加载 MCP 配置 + 连接 Server
    │      │
    │      ├─ loadMcpConfig() 合并两层配置
    │      ├─ 如果有 mcp_servers：
    │      │   └─ new ConnectionManager()
    │      │      └─ manager.connectAll(config, registry)
    │      │         │
    │      │         ├─ 对每个 Server 并行（Promise.allSettled）：
    │      │         │   ├─ new McpClient(name, config)
    │      │         │   ├─ client.connect()
    │      │         │   │   ├─ new StdioTransport / HttpTransport(config)
    │      │         │   │   ├─ jsonRpc.sendRequest("initialize", ...)
    │      │         │   │   └─ jsonRpc.sendNotification("notifications/initialized")
    │      │         │   ├─ client.listTools()
    │      │         │   │   └─ jsonRpc.sendRequest("tools/list")
    │      │         │   ├─ 对每个 toolDef：createAdapter(name, toolDef, client)
    │      │         │   └─ registry.register(adapter)
    │      │         │
    │      │         └─ 日志摘要：成功 X / 失败 Y，注册 Z 个工具
    │      │
    │      └─ 无配置则跳过
    │
    └─ 3. UI 渲染就绪，AgentLoop 可用（registry 已含全部工具）
```

### 工具调用时的数据流

```
AgentLoop 收到 tool_use "filesystem_read_file"
    │
    ▼
ToolScheduler.schedule()
    │
    ▼
executeTool() → registry.get("filesystem_read_file") → McpToolAdapter.execute()
    │
    ▼
McpToolAdapter.execute(params, context)
    │ 内部：client.callTool("read_file", params)
    │
    ▼
jsonRpc.sendRequest("tools/call", { name: "read_file", arguments: params })
    │
    ▼
Transport.send(jsonMessage)          │
    │  ──── 管道/HTTP ────→         │ MCP Server 执行
    │  ←── 管道/HTTP ────           │ 返回结果
    ▼
jsonRpc 配对 id、resolve Promise
    │
    ▼
McpToolAdapter 将 CallToolResult.content 拼接为 ToolResult
    │
    ▼
AgentLoop 收到 ToolResult，回灌给模型
```

## 文件组织

```
src/
├── mcp/                         —— 新增 mcp 子包
│   ├── types.ts                 —— 协议类型（JsonRpcMessage、McpToolDef 等）
│   ├── transport.ts             —— Transport 接口 + StdioTransport + HttpTransport
│   ├── json-rpc.ts              —— JSON-RPC 消息编排（序列化、发送、配对）
│   ├── client.ts                —— McpClient：单个 Server 的全生命周期
│   ├── adapter.ts               —— McpToolAdapter 实现 Tool 接口
│   ├── manager.ts               —— ConnectionManager 管理所有 Server
│   └── config.ts                —— mcp_servers 配置读取、两层合并、env 展开、校验
├── config/
│   └── index.ts                 —— 修改：AppConfig 增加 mcp 段
├── chat/
│   └── chat-service.ts          —— 修改：增加 async init() 方法接入 MCP
└── tui/
    └── app.tsx                  —— 修改：构造函数后调用 await chatService.init()
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| JSON-RPC 消息分隔 | stdio 用 `\n` 换行符 | MCP 官方规范要求 stdio 传输每行一条 JSON |
| HTTP 流式响应 | 用 fetch + SSE 手动解析 | MCP 规范要求支持 SSE，避免引入 SSE 客户端库 |
| 请求-响应配对 | 内存 Map + Promise 回调 | 简单直接，无需引入 MessageChannel 或 EventEmitter |
| 超时时间 | 30 秒 | MCP Server 工具执行可能较慢（如数据库查询），但不会无限等 |
| Transport 接口 | send + onMessage + close | 最简接口，stdio 和 HTTP 都能实现，无多余抽象 |
| 连接并行 | Promise.allSettled | 并行连接减少启动等待时间，allSettled 确保单个失败不中断其他 |
| 工具命名 | `serverName_toolName` | 下划线分隔，简洁清晰，已在 spec 阶段确认 |
| 工具 type | 统一 `"search"` | MCP 工具类型在连接前未知，search 作为通用类型 |
| env/headers 变量展开 | `${VAR}` 语法，统一在 `config.ts` 中展开一次 | 避免多处重复展开或遗漏展开 |
| 配置合并策略 | 项目级覆盖用户级，按 Server name 匹配 | 项目级优先级更高（项目需求覆盖全局需求） |
| async 初始化 | ChatService 增加 `async init()` 方法 | JS 构造函数不能 async，把 MCP 连接从 constructor 中独立出来 |
| MCP 工具 destructive | 默认 `true` | 外部工具有未知副作用，保守按串行安全处理 |
| AbortSignal 转发 | v1 不转发 AbortSignal 到 MCP 调用 | 影响较小，后续迭代补充 |
