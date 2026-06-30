# MCP 客户端 Spec

## 背景

Codia 目前拥有 6 个内置工具（读文件、写文件、编辑文件、glob、grep、执行命令），它们通过
`ToolRegistry` 集中注册并在 `AgentLoop` 中被调用。所有工具实现在内部，无法接入
外部工具。

MCP（Model Context Protocol）是 AI 编程助手的标准化工具协议。大量外部工具（数据库查询、
API 调用、第三方服务）已提供 MCP Server 实现。接入 MCP 后，Codia 的工具生态从"内置的 6
个"拓展到"用户想要的所有"。

用户只需在配置文件里声明要用的 MCP Server，Codia 启动时自动连接并注册工具，
Agent 调用时与内置工具无感。

## 目标

1. 用户在配置文件里声明 MCP Server 列表，Codia 启动时自动发现并注册它们提供的工具
2. 支持本地子进程（stdio）和远程 HTTP（Streamable HTTP）两种传输方式
3. 用适配层把 MCP 工具包装成标准的 `Tool` 接口，Agent 调用远程工具和调用内置工具体验一致
4. 多个 MCP Server 的崩溃互不影响——一个挂了不影响其他 Server 的工具正常运行
5. 配置文件按用户级（`~/.codia/Codia.yml`）和项目级（`.codia/config.yml`）两层合并

## 功能需求

- **F1: Server 配置读取** —— 用户及项目级 YAML 配置文件中，`mcp_servers` 段声明 Server 列表。每个 Server 有 name、type（stdio/http）、对应连接参数。Server name 不允许包含下划线（`_`），避免和 `serverName_toolName` 命名格式冲突。项目级配置覆盖用户级同名 Server（按 name 匹配）。配置格式示例：

  ```yaml
  mcp_servers:
    filesystem:
      type: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      env:
        NODE_ENV: production
        HOME: ${HOME}          # ${VAR} 展开
    weather:
      type: http
      url: https://weather-mcp.example.com/mcp
      headers:
        Authorization: "Bearer ${WEATHER_API_KEY}"
  ```

- **F2: 两层配置合并** —— 启动时先读用户级配置（`~/.codia/Codia.yml`），再读项目级配置（`.codia/config.yml`）。项目级中声明的同名 Server 覆盖用户级定义，项目级独有的 Server 追加，用户级独有的 Server 保留。

- **F3: JSON-RPC 2.0 消息收发** —— 底层按 JSON-RPC 2.0 规范收发消息。每条请求带唯一 id，响应回包用相同 id 关联。通知类消息（无 id）不发响应。支持错误回包，校验 code 字段。

- **F4: stdio 传输** —— 对 type=stdio 的 Server，启动配置声明的本地子进程，通过 stdin/stdout 管道收发 JSON-RPC 消息。进程退出时该 Server 标记为断开。支持配置 env 环境变量（${VAR} 展开）。

- **F5: Streamable HTTP 传输** —— 对 type=http 的 Server，通过 HTTP POST 收发 JSON-RPC 消息（支持 SSE 流式响应）。请求头支持配置声明和 ${VAR} 展开。

- **F6: MCP 会话初始化** —— 每个 Server 连接后三步握手：发送 InitializeRequest 获取 Server 能力，再发 initialized 通知。握手失败标记不可用，不注册工具。

- **F7: 工具列表发现** —— 握手后发送 tools/list 请求，获取工具定义（name、description、inputSchema）。保留所属 Server 来源信息。

- **F8: 工具适配层** —— 把每个远端 MCP 工具包装成 `Tool` 接口：name 为 `serverName_toolName`，type 为 `"search"`，readOnly 为 `false`，destructive 为 `true`（MCP 工具副作用未知，保守按串行安全处理）。execute 内部将调用翻译为 tools/call 请求，检查 `callResult.isError`，结果映射为 `ToolResult`。

- **F9: 工具自动注册** —— MCP 工具适配完成后依次 register 到主 `ToolRegistry`。注册在六个核心工具之后、AgentLoop 启动之前。重名报错。

- **F10: Server 生命周期管理** —— ConnectionManager 集中管理所有连接。启动时并行连接，成功注册工具、失败跳过。关闭时依次断开并终止子进程。

## 非功能需求

- **N1: 隔离性** —— 单个 Server 失败不影响其他 Server 的工具。挂掉的 Server 工具调用返回结构化错误，不抛异常。
- **N2: 日志可观测** —— 每个 Server 的连接过程有结构化日志（Server 名、耗时、工具数）。JSON-RPC 消息在 debug 级别可查。
- **N3: 错误处理分层** —— 配置层（错报）、连接层（日志+跳过）、调用层（返回 `ToolResult { status: "error" }`）。
- **N4: 不加锁** —— 启动时单线程完成，不引入并发控制。

## 不做的事

1. 不实现 MCP 资源、提示词、采样——只做工具能力
2. 不做 Server 健康检查与自动重连——后续迭代
3. 不做工具热更新——启动时确定工具列表
4. 不做 Server 认证/授权——仅支持配置中的 headers
5. 不做 MCP 版本协商——只支持当前协议版本

## 验收标准

- **AC1（配置读取）**：配置 mcp_servers 后启动，日志输出已合并的 Server 列表及配置摘要
- **AC2（两层合并）**：用户级配 A、B，项目级覆盖 A 并新增 C，最终得 A'、B、C
- **AC3（stdio 连接）**：配置 stdio Server，启动后日志输出已连接并注册 N 个工具
- **AC4（HTTP 连接）**：配置 HTTP Server，启动后日志输出连接成功
- **AC5（工具注册）**：工具以 `serverName_toolName` 格式出现在列表中，Agent 可调用
- **AC6（工具调用）**：Agent 调用 MCP 工具时发出 tools/call 请求，结果正常返回
- **AC7（隔离性）**：保活 Server + 坏 Server，保活 Server 正常工作，坏 Server 只影响其自身
- **AC8（错误工具调用）**：调用已挂 Server 的工具返回 `{ status: "error" }` 而非崩溃
- **AC9（配置不完整报错）**：stdio 缺 command 或 HTTP 缺 url，启动时报明确错误
