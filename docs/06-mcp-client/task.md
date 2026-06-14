# MCP 客户端 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/mcp/types.ts` | 协议类型、配置类型 |
| 新建 | `src/mcp/transport.ts` | Transport 接口 + StdioTransport + HttpTransport |
| 新建 | `src/mcp/json-rpc.ts` | JSON-RPC 2.0 消息序列化、请求-响应配对 |
| 新建 | `src/mcp/client.ts` | McpClient：单 Server 会话管理 |
| 新建 | `src/mcp/adapter.ts` | McpToolAdapter：包装为 Tool 接口 |
| 新建 | `src/mcp/config.ts` | mcp_servers 配置读取、两层合并、env 展开、校验 |
| 新建 | `src/mcp/manager.ts` | ConnectionManager：全 Server 生命周期 |
| 修改 | `src/config/index.ts` | AppConfig 增加 mcp 段 |
| 修改 | `src/chat/chat-service.ts` | 增加 `async init()` 方法接入 MCP 连接 |
| 修改 | `src/tui/app.tsx` | 构造函数后调用 `await chatService.init()` |
| 新建 | `src/__tests__/mcp/` | MCP 测试文件 |

## T1: 定义 MCP 协议类型

**文件：** `src/mcp/types.ts`
**依赖：** 无
**步骤：**
1. 定义 `McpServerConfig` 类型——type、command、args、env、url、headers
2. 定义 `McpConfig` 类型——servers map
3. 定义 JSON-RPC 消息类型——Request 和 Response 用 discriminated union（Response 确保 result 和 error 互斥）、Notification、`JsonRpcError`
4. 定义 MCP 协议类型——`InitializeResult`、`McpToolDef`、`CallToolResult`

**验证：** `pnpm exec tsc --noEmit src/mcp/types.ts` 编译通过

## T2: 实现 Transport 接口和两种传输

**文件：** `src/mcp/transport.ts`
**依赖：** T1（types.ts）
**步骤：**
1. 定义 `Transport` 接口：`send(msg)`、`onMessage` 回调、`close()`
2. 实现 `StdioTransport`：
   - `spawn(cmd, args, { env })` 启动子进程（env 已是展开后的值，无需自行展开）
   - stdin.write 发送消息，每条 `JSON.stringify + \n`
   - stdout 逐行读取解析，回调 onMessage
   - close 调用 `child.kill()`
3. 实现 `HttpTransport`：
   - 用 fetch POST 发送消息，请求体为 JSON（headers 已是展开后的值）
   - 响应体检测 Content-Type，普通 JSON 直接解析，SSE 按 data: 行解析
   - close 空实现
4. env 和 headers 的 `${VAR}` 展开不在本模块做——接收的值已经是 config.ts 展开后的结果

**验证：** `pnpm exec tsc --noEmit src/mcp/transport.ts` 编译通过

## T3: 实现 JSON-RPC 消息编排

**文件：** `src/mcp/json-rpc.ts`
**依赖：** T1、T2（types.ts、transport.ts）
**步骤：**
1. 实现 `serialize(msg)` 和反序列化
2. 实现 `JsonRpcHandler` 类：
   - `nextId` 递增生成器
   - `pending = new Map<id, { resolve, reject }>()` 挂载回调
   - `sendRequest(method, params)`：构造 Request，调用 `transport.send`，返回 Promise（挂载到 pending）
   - `sendNotification(method, params)`：构造 Notification（无 id），直接发送
   - `handleMessage(msg)`：收到 Response 时按 id 取 pending 回调 resolve/reject；校验 error 字段
3. 超时：`sendRequest` 第三个可选参数 timeoutMs（默认 30000），用 setTimeout reject

**验证：** `pnpm exec tsc --noEmit src/mcp/json-rpc.ts` 编译通过

## T4: 实现 MCP 客户端

**文件：** `src/mcp/client.ts`
**依赖：** T1、T2、T3
**步骤：**
1. 实现 `McpClient` 类：
   - 属性：`serverName`、`connected`、`tools`（缓存）
   - `connect()`：
     1. 根据 config.type 创建 StdioTransport 或 HttpTransport
     2. 创建 JsonRpcHandler，绑定 Transport.onMessage
     3. 发 `initialize` 请求，带 clientInfo 和 capabilities
     4. 收到 InitializeResult 后发 `notifications/initialized` 通知
     5. 调用 `listTools()` 缓存结果
   - `listTools()`：发 `tools/list`，返回 `McpToolDef[]`
   - `callTool(name, args)`：发 `tools/call`，返回 `CallToolResult`
   - `disconnect()`：关闭 Transport
2. 状态：connected/disconnected/error

**验证：** `pnpm exec tsc --noEmit src/mcp/client.ts` 编译通过

## T5: 实现工具适配器

**文件：** `src/mcp/adapter.ts`
**依赖：** T1、T4（types.ts、client.ts）以及 `src/tool/types.ts`
**步骤：**
1. 实现 `McpToolAdapter` 类，实现 `Tool` 接口：
   - name：`"${serverName}_${toolName}"`
   - description：透传 toolDef.description，缺省用 `"${serverName} 提供的工具"`
   - type：固定 `"search"`
   - readOnly：`false`
   - destructive：`true`（保守原则：MCP 工具副作用未知，确保 ToolScheduler 串行执行）
   - inputSchema：透传 toolDef.inputSchema
   - execute(params, context)：
     1. 调用 `client.callTool(toolName, params)`（传递原始工具名，不带 serverName 前缀）
     2. 检查 `callResult.isError`：若为 true，status 设为 `"error"`
     3. 将 CallToolResult.content 拼接为字符串
     4. 包装为 `ToolResult { status, content }`
     5. callTool 异常时返回 `{ status: "error", content: "MCP Server ${name} 调用失败: ..." }`
   - 已知限制：v1 不转发 `context.signal` 到 MCP 调用
2. 导出工厂函数 `createMcpToolAdapter(serverName, toolDef, client): McpToolAdapter`

**验证：** `pnpm exec tsc --noEmit src/mcp/adapter.ts` 编译通过

## T6: 实现 MCP 配置读取

**文件：** `src/mcp/config.ts`
**依赖：** T1（types.ts）以及 `src/config/index.ts`
**步骤：**
1. 实现 `loadMcpConfig(userConfigPath?, projectConfigPath?): McpConfig`
   - `userConfigPath` 默认 `~/.Codia/Codia.yml`
   - `projectConfigPath` 默认 `<cwd>/.codia/config.yml`
   - 读用户级 YAML，取 `mcp_servers` 段
   - 如果存在项目级配置文件，读项目级 YAML，取 `mcp_servers` 段
   - 深度合并：项目级同名 Server 覆盖用户级；项目级独有的追加；用户级独有的保留
2. 实现 `expandEnvVars(value: string): string`——替换 `${VAR}` 为 `process.env[VAR]`
   - 对所有 Server 配置的 env 值和 headers 值统一展开一次
3. 实现校验函数：
   - stdio 型 Server 必须有 `command` 字段
   - http 型 Server 必须有 `url` 字段
   - type 必须是 `"stdio"` 或 `"http"`
   - Server name 不允许包含 `_`（下划线），避免和 `serverName_toolName` 的命名格式冲突
   - 不合法的 Server 跳过并输出警告日志（不阻塞其他 Server）

**验证：** `pnpm exec tsc --noEmit src/mcp/config.ts` 编译通过

## T7: 实现连接管理器

**文件：** `src/mcp/manager.ts`
**依赖：** T1、T4、T5、T6（types.ts、client.ts、adapter.ts、config.ts）以及 `src/tool/registry.ts`
**步骤：**
1. 实现 `ConnectionManager` 类：
   - `clients = new Map<string, McpClient>()`
   - `connectAll(config: McpConfig, registry: ToolRegistry)`：
     1. 对每个 Server 并行（Promise.allSettled）：
        - `new McpClient(name, serverConfig)`
        - `await client.connect()`
        - `await client.listTools()`
        - 对每个 toolDef：`createMcpToolAdapter(name, toolDef, client)`
        - `registry.register(adapter)`
        - 成功则把 client 存入 clients map
        - 任何步骤异常：log 错误 + 跳过该 Server
     2. 注册前检查工具名冲突：`registry.get(adapterName)` 已存在则报错跳过该工具
     3. 打印最终摘要日志（成功 X/Y，注册 Z 个工具）
   - `disconnectAll()`：遍历 clients，依次 disconnect
2. 使用结构化日志：`[MCP] ${serverName}: 已连接，注册 N 个工具`

**验证：** `pnpm exec tsc --noEmit src/mcp/manager.ts` 编译通过

## T8: 修改 AppConfig 增加 mcp 段

**文件：** 修改 `src/config/index.ts`
**依赖：** T1（types.ts）
**步骤：**
1. 导入 `McpServerConfig` 类型
2. 在 `AppConfig` 接口中增加 `mcp?: { servers: Record<string, McpServerConfig> }` 字段
3. 在 `loadAppConfig` 中解析 `mcp_servers` 段（不做 env 展开和校验—这些在 `src/mcp/config.ts` 中统一处理）
4. 注意：这里只做 YAML 解析提取原始值，加载+合并+展开的完整逻辑在 `src/mcp/config.ts`

**验证：** `pnpm test src/__tests__/config.test.ts` 已有测试继续通过

## T9: 给 ChatService 增加 async init() 方法

**文件：** 修改 `src/chat/chat-service.ts` + `src/tui/app.tsx`
**依赖：** T7、T8
**步骤：**
1. 在 `ChatService` 中新增 `async init(): Promise<void>` 方法
2. 从 constructor 中移除 MCP 连接逻辑（constructor 保持同步，只做原有 6 个工具注册和 prompt 构建）
3. `init()` 方法：
   - 调用 `loadMcpConfig()`（使用默认路径）
   - 如果有 mcp_servers 配置：`await this.manager.connectAll(mcpConfig, this.registry)`
   - 无配置则跳过
4. 将 `ConnectionManager` 存为实例属性 `private mcpManager: ConnectionManager | null`（供后续 disconnect 使用）
5. 修改 `src/tui/app.tsx`：在 `new ChatService(...)` 之后调用 `await chatService.init()`

**验证：** `pnpm exec tsc --noEmit` 编译通过

## T10: MCP 单元测试

**文件：** `src/__tests__/mcp/`（新建目录，多个测试文件）
**依赖：** T1-T9
**步骤：**
1. **T10a - json-rpc 测试：** 用假 Transport 测试 JSON-RPC 请求-响应配对、超时、错误响应
2. **T10b - 适配器测试：** 用假 McpClient 测试 McpToolAdapter 的 execute 方法（含 isError 处理、异常处理）
3. **T10c - 配置合并测试：** 测试两层配置合并逻辑（覆盖、追加、保留）
4. **T10d - 配置校验测试：** stdio 缺 command / http 缺 url / 非法 type / name 含下划线时跳过并警告
5. **T10e - 管理器隔离测试：** 模拟一个 Server 连接失败，另一个正常注册
6. **T10f - ChatService 集成测试：** 模拟带有 mcp_servers 配置的 ChatService 初始化，验证工具已注册到 registry

**验证：** `pnpm test` 全部通过

## 执行顺序

```
T1
├─ T2 → T3 → T4
│              ↘
│                T7 → T8 → T9 → T10
│              ↗
├─ T5 ────────┘
│
└─ T6 ────────┘
```

T2-T3-T4 串行（Transport → JSON-RPC → Client）。T5（adapter）和 T6（config）都只依赖 T1，可与 T2-T4 并行。T7（manager）等待 T4、T5、T6 全部完成，然后 T8 → T9 → T10。
