import type { Tool, ToolResult, ToolContext } from "../tool/types.js";
import type { McpClient } from "./client.js";
import type { McpToolDef } from "./types.js";

// McpToolAdapter —— 将 MCP 远端工具包装为 Codia 的 Tool 接口
// Agent 调用时完全无感，和内置工具使用方式一致
export class McpToolAdapter implements Tool {
  readonly name: string;
  readonly description: string;
  readonly type: "search" = "search";
  readonly readOnly = false;
  readonly destructive = true; // 保守原则：MCP 工具副作用未知，ToolScheduler 串行执行
  readonly inputSchema;

  private client: McpClient;
  private toolName: string; // MCP Server 原文工具名（不带 serverName 前缀）

  constructor(
    serverName: string,
    toolDef: McpToolDef,
    client: McpClient,
  ) {
    this.name = `${serverName}_${toolDef.name}`;
    this.description =
      toolDef.description ?? `${serverName} 提供的工具`;
    this.inputSchema = toolDef.inputSchema;
    this.client = client;
    this.toolName = toolDef.name;
  }

  // execute —— 将调用翻译为 MCP tools/call 请求，映射结果为 ToolResult
  async execute(
    params: Record<string, unknown>,
    _context: ToolContext, // v1 不转发 AbortSignal
  ): Promise<ToolResult> {
    try {
      const callResult = await this.client.callTool(this.toolName, params);

      // 拼接 content 为字符串
      const content = callResult.content
        .map((c) => {
          if (c.type === "text") return c.text;
          if (c.type === "image") return `[图片: ${c.mimeType}]`;
          return "";
        })
        .join("\n");

      return {
        status: callResult.isError ? "error" : "success",
        content,
      };
    } catch (e) {
      return {
        status: "error",
        content: `MCP Server "${this.client.serverName}" 调用工具 "${this.toolName}" 失败：${(e as Error).message}`,
      };
    }
  }
}

// createMcpToolAdapter —— 工厂函数
export function createMcpToolAdapter(
  serverName: string,
  toolDef: McpToolDef,
  client: McpClient,
): McpToolAdapter {
  return new McpToolAdapter(serverName, toolDef, client);
}
