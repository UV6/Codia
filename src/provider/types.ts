import type { ToolCall, ToolResult } from "../tool/types.js";

// ChatConfig —— YAML 配置文件中的 LLM 供应商信息
export interface ChatConfig {
  protocol: "anthropic" | "openai";
  model: string;
  baseUrl: string;
  apiKey: string;
}

// Message —— 对话历史中的单条消息，也是 JSONL 文件每行的格式
export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string; // ISO 8601
  usage?: {
    inputTokens: number;
    outputTokens: number;
    model: string;
  };
  thinking?: string; // Claude extended thinking 内容
  toolCalls?: ToolCall[]; // assistant 消息可能含工具调用
  toolResult?: ToolResult; // user-like 消息含单个工具执行结果（兼容旧格式）
  toolUseId?: string; // 关联单个 tool_result 和 tool_use（兼容旧格式）
  toolResults?: Array<{ toolUseId: string; result: ToolResult }>; // 同轮多个工具结果
}

// Chunk —— Provider 流式输出的最小单元
export type Chunk =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "usage"; usage: { inputTokens: number; outputTokens: number; model: string } }
  | { type: "error"; error: { code: "auth" | "rate_limit" | "network" | "unknown"; message: string } }
  | { type: "done" }
  | { type: "tool_use"; call: ToolCall }
  | { type: "tool_status"; name: string; param: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_input_delta"; partialJson: string };

// LLMProvider —— 统一的后端抽象接口
export interface LLMProvider {
  readonly name: string;
  streamChat(
    messages: Message[],
    config: ChatConfig,
    signal: AbortSignal,
    tools?: Record<string, unknown>[],
    systemPrompt?: string,
  ): AsyncIterable<Chunk>;
}
