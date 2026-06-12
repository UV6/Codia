import {
  readFileSync,
  existsSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import type { Message } from "../provider/types.js";

// 会话存储目录
export const SESSIONS_DIR = join(homedir(), ".Codia", "sessions");

// 确保会话目录存在
function ensureSessionsDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

// 会话文件名后缀
const SESSION_EXT = ".jsonl";

// newSessionPath —— 生成新会话的文件路径
// 格式：~/.Codia/sessions/2026-06-09-1130.jsonl
export function newSessionPath(): string {
  ensureSessionsDir();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const id = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return join(SESSIONS_DIR, `${id}${SESSION_EXT}`);
}

// sessionPath —— 根据会话 ID 或名称获取路径
export function sessionPath(sessionId: string): string {
  ensureSessionsDir();
  // 如果传了完整路径则直接返回
  if (sessionId.includes("/")) {
    return sessionId;
  }
  // 自动补扩展名
  const name = sessionId.endsWith(SESSION_EXT) ? sessionId : `${sessionId}${SESSION_EXT}`;
  return join(SESSIONS_DIR, name);
}

// 会话摘要信息
export interface SessionInfo {
  id: string; // 不含扩展名的文件名
  path: string;
  messageCount: number;
  lastMessageTime: string; // ISO 8601
  preview: string; // 第一条用户消息的前 60 字
}

// listSessions —— 列出所有会话及其摘要
// 按修改时间倒序
export function listSessions(): SessionInfo[] {
  ensureSessionsDir();

  try {
    const files = readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith(SESSION_EXT))
      .map((f) => ({
        name: f,
        path: join(SESSIONS_DIR, f),
        stat: statSync(join(SESSIONS_DIR, f)),
      }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    return files.map((f) => {
      const messages = loadHistory(f.path);
      const firstUser = messages.find((m) => m.role === "user");
      const lastMsg = messages[messages.length - 1];

      return {
        id: basename(f.name, SESSION_EXT),
        path: f.path,
        messageCount: messages.length,
        lastMessageTime: lastMsg?.timestamp ?? f.stat.mtime.toISOString(),
        preview: firstUser?.content.slice(0, 60) ?? "",
      };
    });
  } catch {
    return [];
  }
}

// loadHistory —— 从 JSONL 文件读取所有消息
export function loadHistory(filePath: string): Message[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const messages: Message[] = [];
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((line) => line.trim() !== "");

  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as Message;
      if (msg.role && (msg.content || msg.toolCalls || msg.toolResult)) {
        messages.push(msg);
      }
    } catch {
      console.warn(`[HistoryManager] 跳过损坏行：${line.slice(0, 50)}...`);
    }
  }

  return messages;
}

// appendMessage —— 向 JSONL 文件追加一条消息
export function appendMessage(filePath: string, msg: Message): void {
  ensureSessionsDir();
  appendFileSync(filePath, JSON.stringify(msg) + "\n", "utf-8");
}
