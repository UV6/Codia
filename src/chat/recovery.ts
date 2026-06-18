import type { Message } from "../provider/types.js";
import type { SessionRecoveryResult, BootstrapDiagnostic } from "../bootstrap/types.js";
import { loadHistory } from "./history.js";

// 时间跨度阈值（默认 3 天）
const GAP_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

export interface RecoveryOptions {
  sessionId: string;
  filePath: string;
  now: Date;
  gapThresholdMs?: number;
  maxContextTokens?: number; // 超限判断用，恢复阶段只打标记
}

// recoverSession —— 恢复一个历史会话
export function recoverSession(options: RecoveryOptions): SessionRecoveryResult {
  const { sessionId, filePath, now, gapThresholdMs = GAP_THRESHOLD_MS } = options;
  const warnings: string[] = [];
  const diagnostics: BootstrapDiagnostic[] = [];

  // 读取原始记录
  const rawRecords = loadHistory(filePath);
  if (rawRecords.length === 0) {
    return {
      sessionId,
      messages: [],
      truncated: false,
      compressed: false,
      gapNoticeInserted: false,
      warnings: ["会话文件为空或全部损坏"],
    };
  }

  // 跳过坏行已在 loadHistory 中处理，这里做工具调用配对检查
  let messages = [...rawRecords];

  // 检测尾部未配对工具调用
  const trimmed = trimUnpairedTail(messages);
  const truncated = trimmed.length < messages.length;
  if (truncated) {
    warnings.push(
      `尾部 ${messages.length - trimmed.length} 条记录被截断（工具调用/结果未配对）`,
    );
    messages = trimmed;
  }

  // 时间跨度检查
  let gapNoticeInserted = false;
  const lastActivity = findLastActivity(messages);
  if (lastActivity) {
    const gap = now.getTime() - new Date(lastActivity).getTime();
    if (gap > gapThresholdMs) {
      const days = Math.round(gap / (24 * 60 * 60 * 1000));
      messages.push({
        role: "system",
        content: `[会话提醒] 距离上次活动已过去约 ${days} 天，请注意时间跨度可能影响上下文。`,
        timestamp: now.toISOString(),
      });
      gapNoticeInserted = true;
    }
  }

  // 上下文超限判断（恢复阶段只判断并打标记，压缩交给正常请求链路）
  let compressed = false;
  const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  const approxTokens = Math.ceil(totalChars / 3); // 粗略估算
  if (options.maxContextTokens && approxTokens > options.maxContextTokens) {
    compressed = true; // 标记需要压缩，实际压缩由 ContextManager.preRequest 执行
    warnings.push("恢复上下文超出安全范围，将在首轮请求前执行一次性压缩");
  }

  return {
    sessionId,
    messages,
    truncated,
    compressed,
    gapNoticeInserted,
    warnings,
    lastActivityAt: lastActivity ?? undefined,
  };
}

// trimUnpairedTail —— 从尾部开始截断未闭合的工具调用/结果
function trimUnpairedTail(messages: Message[]): Message[] {
  // 从后往前数，找到最后一个"安全点"
  // 安全点:
  //   user 消息（没有 toolResult/toolResults）
  //   assistant 消息（没有 toolCalls）
  //   tool 结果消息（旧格式 toolResult 或新格式 toolResults）
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    // assistant 消息末尾没有未完成的 toolCalls
    if (m.role === "assistant" && (!m.toolCalls || m.toolCalls.length === 0)) {
      return messages.slice(0, i + 1);
    }
    // user 消息带着 toolResult 或 toolResults 完成了一个工具回路
    if (m.role === "user" && (m.toolResult || m.toolResults)) {
      return messages.slice(0, i + 1);
    }
    // 普通 user 消息
    if (m.role === "user" && !m.toolResult && !m.toolResults) {
      return messages.slice(0, i + 1);
    }
    // system 消息
    if (m.role === "system") {
      return messages.slice(0, i + 1);
    }
  }
  // 如果无法确定安全点，返回空
  return [];
}

// findLastActivity —— 找到最后一条有 timestamp 的记录时间
function findLastActivity(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].timestamp) return messages[i].timestamp;
  }
  return null;
}
