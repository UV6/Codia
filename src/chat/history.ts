import {
  readFileSync,
  existsSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join, basename, resolve } from "node:path";
import type { Message } from "../provider/types.js";
import type {
  SessionSummary,
  SessionRecoveryResult,
  BootstrapDiagnostic,
} from "../bootstrap/types.js";

// 会话文件名后缀
const SESSION_EXT = ".jsonl";
// 随机后缀长度
const RANDOM_SUFFIX_LEN = 4;

// randSuffix —— 生成小写数字字母随机后缀
function randSuffix(len: number): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

// getSessionsDir —— 获取项目 sessions 目录
export function getSessionsDir(projectRoot?: string): string {
  const root = projectRoot ?? process.cwd();
  return resolve(root, "sessions");
}

// ensureSessionsDir —— 确保会话目录存在
function ensureSessionsDir(projectRoot?: string): void {
  const dir = getSessionsDir(projectRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// newSessionPath —— 生成新会话文件路径
// 格式：<project-root>/sessions/YYYYMMDD-HHMMSS-xxxx.jsonl
export function newSessionPath(now?: Date, projectRoot?: string): string {
  ensureSessionsDir(projectRoot);
  const d = now ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const id = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${randSuffix(RANDOM_SUFFIX_LEN)}`;
  return join(getSessionsDir(projectRoot), `${id}${SESSION_EXT}`);
}

// sessionPath —— 根据会话 ID 获取路径
export function sessionPath(sessionId: string, projectRoot?: string): string {
  const dir = getSessionsDir(projectRoot);
  ensureSessionsDir(projectRoot);
  if (sessionId.includes("/")) return sessionId;
  const name = sessionId.endsWith(SESSION_EXT) ? sessionId : `${sessionId}${SESSION_EXT}`;
  return join(dir, name);
}

// loadHistory —— 从 JSONL 文件读取所有有效消息
export function loadHistory(filePath: string): Message[] {
  if (!existsSync(filePath)) return [];
  const messages: Message[] = [];
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((line) => line.trim() !== "");
  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as Message;
      if (msg.role && (msg.content || msg.toolCalls || msg.toolResult || msg.toolResults)) {
        messages.push(msg);
      }
    } catch {
      console.warn(`[HistoryManager] 跳过损坏行：${line.slice(0, 50)}...`);
    }
  }
  return messages;
}

// appendMessage —— 追加写一条消息到 JSONL
export function appendMessage(filePath: string, msg: Message): void {
  const dir = join(filePath, "..");
  if (!existsSync(dir)) mkdirSync(resolve(dir), { recursive: true });
  appendFileSync(filePath, JSON.stringify(msg) + "\n", "utf-8");
}

// listSessions —— 列出所有会话摘要
export function listSessions(projectRoot?: string): SessionSummary[] {
  const dir = getSessionsDir(projectRoot);
  if (!existsSync(dir)) return [];
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(SESSION_EXT))
      .map((f) => ({
        name: f,
        path: join(dir, f),
        stat: statSync(join(dir, f)),
      }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    return files.map((f) => {
      const messages = loadHistory(f.path);
      const firstUser = messages.find((m) => m.role === "user");
      const lastMsg = messages[messages.length - 1];
      const hasBad = messages.length > 0
        ? false // loadHistory skips bad lines already
        : false;
      return {
        id: basename(f.name, SESSION_EXT),
        path: f.path,
        title: firstUser?.content?.slice(0, 60) ?? "",
        messageCount: messages.length,
        lastActivityAt: lastMsg?.timestamp ?? f.stat.mtime.toISOString(),
        isCorrupted: hasBad,
        recoverable: messages.length > 0,
        warnings: messages.length === 0 ? ["会话文件为空或全部损坏"] : [],
      };
    });
  } catch {
    return [];
  }
}

// cleanupExpiredSessions —— 清理超过保留期的旧会话
export function cleanupExpiredSessions(
  now: Date,
  retentionDays: number = 30,
  projectRoot?: string,
): BootstrapDiagnostic[] {
  const diagnostics: BootstrapDiagnostic[] = [];
  const dir = getSessionsDir(projectRoot);
  if (!existsSync(dir)) return diagnostics;
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(SESSION_EXT)) continue;
      const fp = join(dir, f);
      const stat = statSync(fp);
      if (stat.mtimeMs < cutoff) {
        unlinkSync(fp);
        diagnostics.push({
          source: "session",
          level: "info",
          message: `已删除过期会话：${f}（修改时间：${stat.mtime.toISOString()}）`,
          code: "SESSION_EXPIRED_CLEANUP",
        });
      }
    }
  } catch (e) {
    diagnostics.push({
      source: "session",
      level: "warning",
      message: `会话清理出错：${(e as Error).message}`,
      code: "SESSION_CLEANUP_ERROR",
    });
  }
  return diagnostics;
}
