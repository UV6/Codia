import type { Chunk, Message, LLMProvider, ChatConfig } from "../provider/types.js";
import type { ToolCall, ToolResult } from "../tool/types.js";
import type { ToolRegistry } from "../tool/registry.js";
import type { PermissionMode, HumanInTheLoopCallback } from "../permission/types.js";
import type { CompressEvent } from "../context/types.js";
import type { HookEngine } from "../hook/engine.js";
import type { AgentRole } from "./role/types.js";

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

export type TaskPhaseStatus = "pending" | "in_progress" | "completed" | "failed";

// TaskPhase —— 长任务中的阶段状态
export interface TaskPhase {
  id: string;
  title: string;
  taskTitle?: string;
  status: TaskPhaseStatus;
}

// AgentEvent —— Agent Loop 向外推送的事件类型
// 在现有 Chunk 基础上扩展 Agent 层特有事件
export type AgentEvent =
  | Chunk
  | CompressEvent
  | { type: "plan_update"; phases: TaskPhase[] }
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

// 以下为子 Agent 系统类型

// SubAgentConfig —— 子 Agent 运行器的输入配置
export interface SubAgentConfig {
  type: "definition" | "fork";
  role?: AgentRole; // 定义式必填
  prompt: string; // 任务描述
  description: string; // 简短描述，用于进度展示
  name?: string; // 显示名称
  model?: string; // 模型覆盖
  isolation: boolean; // 是否启用 worktree 文件系统隔离
  runInBackground: boolean; // 是否后台运行（Fork 强制 true）
  parentMessages: Message[]; // 父对话消息（Fork 式继承用）
  parentProvider: LLMProvider;
  parentChatConfig: ChatConfig;
  parentRegistry: ToolRegistry;
  parentHookEngine?: HookEngine;
  cwd: string; // 工作目录
  signal: AbortSignal; // 取消信号
}

// SubAgentResult —— 子 Agent 运行完成后的返回结果
export interface SubAgentResult {
  status: "completed" | "failed" | "max_rounds" | "cancelled";
  text: string; // 子 Agent 的最终文本输出
  usage: {
    inputTokens: number;
    outputTokens: number;
    model: string;
  };
  rounds: number; // 实际执行的轮次数
  toolCalls: number; // 实际执行了多少次工具调用
}

// BackgroundTask —— 后台任务管理器中的单条追踪记录
export interface BackgroundTask {
  id: string; // 唯一标识
  status: "running" | "completed" | "failed";
  type: string; // 角色名或 "fork"
  description: string; // 创建时的描述
  startTime: string; // ISO 8601
  result?: SubAgentResult; // 完成时填充
}
