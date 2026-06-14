import type { McpServerConfig, McpToolDef, CallToolResult } from "./types.js";
import { StdioTransport, HttpTransport, type Transport } from "./transport.js";
import { JsonRpcHandler } from "./json-rpc.js";

// McpClient —— 单个 MCP Server 的完整会话管理
// 生命周期：connect() → listTools() / callTool() → disconnect()
export class McpClient {
  readonly serverName: string;
  private config: McpServerConfig;
  private transport: Transport | null = null;
  private rpc: JsonRpcHandler | null = null;
  private tools: McpToolDef[] | null = null;
  private _connected = false;

  constructor(serverName: string, config: McpServerConfig) {
    this.serverName = serverName;
    this.config = config;
  }

  get connected(): boolean {
    return this._connected;
  }

  // connect —— 建立连接并执行初始化握手
  async connect(): Promise<void> {
    try {
      // 1. 创建 Transport
      this.transport = this.createTransport();

      // 2. 创建 JsonRpcHandler，绑定 Transport
      this.rpc = new JsonRpcHandler(this.transport);

      // 3. 发送 initialize 请求
      const initResult = (await this.rpc.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "Codia",
          version: "0.1.0",
        },
      })) as { protocolVersion: string; capabilities: unknown; serverInfo: unknown };

      console.log(
        `[MCP] ${this.serverName}: 已连接 ${initResult.serverInfo ? `(${JSON.stringify(initResult.serverInfo)})` : ""}，协议版本 ${initResult.protocolVersion}`,
      );

      // 4. 发送 initialized 通知
      await this.rpc.sendNotification("notifications/initialized");

      // 5. 获取工具列表
      await this.fetchTools();

      this._connected = true;
    } catch (e) {
      this._connected = false;
      // 失败时清理
      this.rpc?.cancelAll();
      await this.transport?.close();
      throw e;
    }
  }

  // listTools —— 获取 Server 提供的工具列表
  async listTools(): Promise<McpToolDef[]> {
    if (!this.rpc) {
      throw new Error(`MCP Server "${this.serverName}" 未连接`);
    }
    await this.fetchTools();
    return this.tools ?? [];
  }

  // callTool —— 调用 MCP 工具
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    if (!this.rpc) {
      return {
        content: [
          { type: "text", text: `MCP Server "${this.serverName}" 未连接` },
        ],
        isError: true,
      };
    }

    const result = (await this.rpc.sendRequest("tools/call", {
      name,
      arguments: args,
    })) as CallToolResult;

    return result;
  }

  // disconnect —— 断开连接
  async disconnect(): Promise<void> {
    this._connected = false;
    this.rpc?.cancelAll();
    await this.transport?.close();
    this.transport = null;
    this.rpc = null;
    this.tools = null;
  }

  // fetchTools —— 从 Server 获取工具列表并缓存
  private async fetchTools(): Promise<void> {
    if (!this.rpc) {
      throw new Error(`MCP Server "${this.serverName}" 未连接`);
    }
    const result = (await this.rpc.sendRequest("tools/list")) as {
      tools: McpToolDef[];
    };
    this.tools = result.tools ?? [];
    console.log(
      `[MCP] ${this.serverName}: 已连接，注册 ${this.tools.length} 个工具`,
    );
  }

  // createTransport —— 根据配置类型创建传输层
  private createTransport(): Transport {
    if (this.config.type === "stdio") {
      if (!this.config.command) {
        throw new Error(
          `MCP Server "${this.serverName}" 配置错误：stdio 类型必须提供 command`,
        );
      }
      return new StdioTransport(
        this.config.command,
        this.config.args ?? [],
        this.config.env,
      );
    } else {
      if (!this.config.url) {
        throw new Error(
          `MCP Server "${this.serverName}" 配置错误：http 类型必须提供 url`,
        );
      }
      return new HttpTransport(this.config.url, this.config.headers);
    }
  }
}
