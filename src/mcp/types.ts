import type { ToolInputSchema } from "../tool/types.js";

// ─── 配置类型 ───

// McpServerConfig —— 单个 MCP Server 的配置
export interface McpServerConfig {
  type: "stdio" | "http";
  // stdio 专用
  command?: string;
  args?: string[];
  env?: Record<string, string>; // 值支持 ${VAR} 展开，在 config.ts 中统一处理
  // http 专用
  url?: string;
  headers?: Record<string, string>; // 值支持 ${VAR} 展开
}

// McpConfig —— 完整 MCP 配置
export interface McpConfig {
  servers: Record<string, McpServerConfig>; // key = Server 名
}

// ─── JSON-RPC 2.0 类型 ───

// JsonRpcError —— JSON-RPC 错误对象
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// JsonRpcRequest —— JSON-RPC 请求
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

// JsonRpcResponse —— JSON-RPC 响应（result 和 error 互斥，discriminated union）
export type JsonRpcResponse = { jsonrpc: "2.0"; id: number | string } & (
  | { result: unknown; error?: never }
  | { result?: never; error: JsonRpcError }
);

// JsonRpcNotification —— JSON-RPC 通知（无 id，不期待响应）
export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// JsonRpcMessage —— JSON-RPC 消息联合类型
export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcResponse
  | JsonRpcNotification;

// ─── MCP 协议类型 ───

// InitializeResult —— initialize 请求的响应
export interface InitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: {}; // 只关心 tools 能力
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

// McpToolDef —— MCP Server 返回的工具定义（tools/list 响应中的单个条目）
export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: ToolInputSchema;
}

// CallToolResult —— tools/call 的响应
export interface CallToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
}
