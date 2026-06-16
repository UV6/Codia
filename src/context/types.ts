import type { ToolResult } from "../tool/types.js";

// CompressEvent —— 压缩相关事件，通过 AgentEvent 流 yield 给 TUI
export interface CompressEvent {
  type: "compress";
  action: "tool_result_stored" | "manual_compress" | "auto_compress" | "compress_failed";
  message?: string;
  path?: string; // 存盘文件路径
  savedTokens?: number; // 节省的 token 估算数
  summary?: string; // 摘要内容预览（前 200 字）
}

// TokenAnchor —— token 估算锚点
export interface TokenAnchor {
  inputTokens: number; // 上次 API 返回的 inputTokens
  messageIndex: number; // 该锚点对应的 messages 数组长度（条数）
}

// CompressedResult —— 压缩后的工具结果
export interface CompressedResult {
  result: ToolResult; // 压缩后的结果（预览+路径 或 原始完整内容）
  stored: boolean; // 是否已存盘
  filePath?: string; // 存盘路径
}
