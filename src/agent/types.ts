import type { Chunk } from "../provider/types.js";
import type { ToolCall, ToolResult } from "../tool/types.js";
import type { PermissionMode, HumanInTheLoopCallback } from "../permission/types.js";
import type { CompressEvent } from "../context/types.js";

// StopReason —— 循环停止原因
export type StopReason =
  | "done"              // 模型自然结束（无工具调用）
  | "max_rounds"        // 达到迭代上限
  | "cancelled"         // 用户取消
  | "unknown_tool"      // 本轮请求的所有工具均不存在
  | "stream_error";     // LLM 流输出错误

// AgentLoopConfig —— 循环配置
export interface AgentLoopConfig {
  maxRounds: number;        // 迭代上限，默认 20
  mode: "full" | "plan";    // 模式：全能力 / 只读计划
  planFilePath?: string;    // plan mode 下的计划输出文件
  permissionMode?: PermissionMode;     // 权限模式，默认 "default"
  humanInTheLoop?: HumanInTheLoopCallback;  // 人在回路回调
  allowedTools?: string[];  // Skill 白名单过滤，存在时仅允许列表中的工具
}

// AgentEvent —— Agent Loop 向外推送的事件类型
// 在现有 Chunk 基础上扩展 Agent 层特有事件
export type AgentEvent =
  | Chunk
  | CompressEvent
  | { type: "tool_execution_start"; callId: string; name: string }
  | { type: "tool_result"; callId: string; name: string; result: ToolResult }
  | { type: "round_start"; round: number }
  | { type: "round_end"; round: number }
  | { type: "stopped"; reason: StopReason };

// StreamResult —— 一轮 LLM 响应的完整收集结果
export interface StreamResult {
  fullText: string;
  toolCalls: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number; model: string };
  hadError: boolean;
}

// ScheduleResult —— 工具调度执行结果
export interface ScheduleResult {
  callId: string;
  name: string;
  result: ToolResult;
}
