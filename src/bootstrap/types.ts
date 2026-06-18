import type { Message } from "../provider/types.js";

// BootstrapDiagnosticSource —— 启动恢复诊断来源
export type BootstrapDiagnosticSource = "instruction" | "session" | "memory" | "bootstrap";

// BootstrapDiagnosticLevel —— 启动恢复诊断级别
export type BootstrapDiagnosticLevel = "info" | "warning" | "error";

// BootstrapDiagnostic —— 单条启动恢复诊断
export interface BootstrapDiagnostic {
  source: BootstrapDiagnosticSource;
  level: BootstrapDiagnosticLevel;
  message: string;
  code?: string;
}

// BootstrapDiagnostics —— 启动恢复过程的聚合诊断信息
export interface BootstrapDiagnostics {
  entries: BootstrapDiagnostic[];
}

// SessionSummary —— 会话列表摘要
export interface SessionSummary {
  id: string;
  path: string;
  title: string;
  messageCount: number;
  lastActivityAt?: string;
  isCorrupted: boolean;
  recoverable: boolean;
  warnings: string[];
}

// SessionRecoveryResult —— 会话恢复后的结构化结果
export interface SessionRecoveryResult {
  sessionId: string;
  messages: Message[];
  truncated: boolean;
  compressed: boolean;
  gapNoticeInserted: boolean;
  warnings: string[];
  lastActivityAt?: string;
}

// BootstrapContext —— 启动恢复编排器输出给 ChatService 的上下文
export interface BootstrapContext {
  instructionText: string;
  memoryText: string;
  recoveredMessages: Message[];
  diagnostics: BootstrapDiagnostics;
  sessionSummary?: SessionSummary;
}
