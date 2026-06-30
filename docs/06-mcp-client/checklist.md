# MCP 客户端 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 编译检查
- [ ] `src/mcp/types.ts` 已创建，所有类型定义完整（验证：`pnpm exec tsc --noEmit` 编译通过）
- [ ] `src/mcp/transport.ts` 已创建，StdioTransport 和 HttpTransport 已实现（验证：编译通过）
- [ ] `src/mcp/json-rpc.ts` 已创建，请求-响应配对逻辑已实现（验证：编译通过）
- [ ] `src/mcp/client.ts` 已创建，单 Server 会话管理已实现（验证：编译通过）
- [ ] `src/mcp/adapter.ts` 已创建，McpToolAdapter 实现 Tool 接口（验证：编译通过）
- [ ] `src/mcp/config.ts` 已创建，两层合并、env 展开和校验已实现（验证：编译通过）
- [ ] `src/mcp/manager.ts` 已创建，ConnectionManager 已实现（验证：编译通过）
- [ ] `src/config/index.ts` 已修改，AppConfig 增加 mcp 段（验证：编译通过）
- [ ] `src/chat/chat-service.ts` 已修改，async init() 方法接入 MCP（验证：编译通过）
- [ ] `src/tui/app.tsx` 已修改，构造函数后调用 `await chatService.init()`（验证：编译通过）

## 行为验证
- [ ] json-rpc 单元测试覆盖请求-响应配对、超时、错误响应（验证：`pnpm test` 通过）
- [ ] 适配器单元测试覆盖正常调用、isError 处理、异常处理（验证：`pnpm test` 通过）
- [ ] 配置单元测试覆盖两层合并、不合法配置跳过（验证：`pnpm test` 通过）
- [ ] 隔离性单元测试覆盖一个好 Server + 一个坏 Server 的场景（验证：`pnpm test` 通过）
- [ ] ChatService + MCP 集成测试覆盖完整启动流程（验证：`pnpm test` 通过）

## 集成
- [ ] ChatService.init() 正确调用 ConnectionManager.connectAll（验证：`pnpm exec tsc --noEmit` 无类型错误）
- [ ] MCP 工具注册在 6 个核心工具之后、AgentLoop 创建之前（验证：观察启动日志中的工具注册顺序）
- [ ] 所有公开接口至少被一个真实调用方使用（验证：编译 + 全部测试通过）

## 编译与测试
- [ ] 项目编译无错误（验证：`pnpm exec tsc --noEmit`）
- [ ] 所有单元测试通过（验证：`pnpm test`）
- [ ] 新建测试文件覆盖 json-rpc、adapter、config、manager、集成（验证：`pnpm test` 输出中所有新增测试通过）

## 端到端场景

- [ ] 场景 1（stdio 工具注册 + 调用）：在 `~/.codia/Codia.yml` 中配置一个本地 stdio Server，启动 Codia，检查日志输出 "已连接，注册 N 个工具"，然后让 Agent 调用该工具，观察返回结果正常
- [ ] 场景 2（HTTP 工具注册）：配置一个 HTTP MCP Server，启动 Codia，检查日志输出连接成功，工具列表中出现对应的 `serverName_toolName`
- [ ] 场景 3（两层合并）：用户级配 Server A 和 B，项目级覆盖 A 的 url 并新增 C，启动 Codia，检查日志显示合并后结果为 A'、B、C
- [ ] 场景 4（坏 Server 隔离）：配置一个正常 Server 和一个坏 Server（如 command 指向不存在的路径），启动 Codia，正常 Server 的工具可调用，坏 Server 只打印错误日志，不影响其他
- [ ] 场景 5（调用已断开的 Server）：启动后手动终止某个 Server 的子进程，然后让 Agent 调用该 Server 的工具，返回 `{ status: "error" }` 格式的错误结果而非崩溃
- [ ] 场景 6（配置不完整报错）：stdio Server 缺少 command 字段，启动时日志输出警告信息，该 Server 被跳过
- [ ] 场景 7（无 mcp_servers 配置）：不配置任何 MCP Server，Codia 正常启动，工具列表中只有 6 个内置工具
- [ ] 场景 8（`${VAR}` 展开）：在启动日志中开启 debug 级别，检查 config.ts 输出的已展开配置确认 `${VAR}` 已正确替换为环境变量值（或在 Transport 中添加 debug 日志输出已展开的 headers/env 值）
