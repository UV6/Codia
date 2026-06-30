import {
  readFileSync,
  existsSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { join, basename, resolve } from "node:path";
import type { Message } from "../provider/types.js";
import type {
  SessionSummary,
  BootstrapDiagnostic,
} from "../bootstrap/types.js";
import {
  getLegacySessionsDir,
  getSessionsDir as getRuntimeSessionsDir,
  migrateDirectoryContents,
  resolveProjectIdentity,
} from "../storage/paths.js";

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

// extractDateFromSessionId —— 从会话 ID 提取日期前缀 (YYYYMMDD)
function extractDateFromSessionId(id: string): string | null {
  const match = id.match(/^(\d{8})-(\d{6})-/);
  return match ? match[1] : null;
}

function ensureSessionsMigrated(projectRoot?: string): string {
  const root = projectRoot ?? process.cwd();
  const identity = resolveProjectIdentity(root);
  const runtimeDir = getRuntimeSessionsDir(identity.repoRoot);
  const legacyDir = getLegacySessionsDir(identity.repoRoot);

  if (existsSync(legacyDir) && resolve(legacyDir) !== resolve(runtimeDir)) {
    migrateDirectoryContents(legacyDir, runtimeDir);
  }

  if (!existsSync(runtimeDir)) {
    mkdirSync(runtimeDir, { recursive: true });
  }

  return runtimeDir;
}

// getSessionsDir —— 获取项目会话目录（用户目录下的项目运行态）
export function getSessionsDir(projectRoot?: string): string {
  const root = projectRoot ?? process.cwd();
  return getRuntimeSessionsDir(resolveProjectIdentity(root).repoRoot);
}

// newSessionPath —— 生成新会话文件路径
// 格式：~/.codia/projects/<project-id>/sessions/YYYYMMDD/YYYYMMDD-HHMMSS-xxxx.jsonl
export function newSessionPath(now?: Date, projectRoot?: string): string {
  const d = now ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const id = `${dateStr}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${randSuffix(RANDOM_SUFFIX_LEN)}`;
  const dateDir = join(ensureSessionsMigrated(projectRoot), dateStr);
  if (!existsSync(dateDir)) {
    mkdirSync(dateDir, { recursive: true });
  }
  return join(dateDir, `${id}${SESSION_EXT}`);
}

// sessionPath —— 根据会话 ID 获取路径
// 支持新格式（日期子目录）和旧格式（sessions 根目录平铺）
export function sessionPath(sessionId: string, projectRoot?: string): string {
  const root = projectRoot ?? process.cwd();
  const identity = resolveProjectIdentity(root);
  const dir = ensureSessionsMigrated(identity.repoRoot);
  if (sessionId.includes("/")) return sessionId;
  const name = sessionId.endsWith(SESSION_EXT) ? sessionId : `${sessionId}${SESSION_EXT}`;
  // 尝试从 sessionId 提取日期，在日期子目录下查找
  const dateStr = extractDateFromSessionId(sessionId);
  if (dateStr) {
    const datePath = join(dir, dateStr, name);
    if (existsSync(datePath)) return datePath;
  }
  // 回退：在 sessions 根目录查找（兼容旧格式）
  const flatPath = join(dir, name);
  if (existsSync(flatPath)) return flatPath;

  // 兼容旧项目内路径
  const legacyDir = getLegacySessionsDir(identity.repoRoot);
  if (dateStr) {
    const legacyDatePath = join(legacyDir, dateStr, name);
    if (existsSync(legacyDatePath)) return legacyDatePath;
  }
  return join(legacyDir, name);
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

// collectSessionFiles —— 递归收集 sessions 目录下所有 .jsonl 文件
function collectSessionFiles(sessionsDir: string): { name: string; path: string; mtime: Date }[] {
  const result: { name: string; path: string; mtime: Date }[] = [];
  try {
    const entries = readdirSync(sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // 递归进入日期子目录
        const subDir = join(sessionsDir, entry.name);
        try {
          const subFiles = readdirSync(subDir);
          for (const f of subFiles) {
            if (f.endsWith(SESSION_EXT)) {
              result.push({
                name: f,
                path: join(subDir, f),
                mtime: statSync(join(subDir, f)).mtime,
              });
            }
          }
        } catch {
          // 跳过无法读取的子目录
        }
      } else if (entry.isFile() && entry.name.endsWith(SESSION_EXT)) {
        // 兼容旧格式：sessions 根目录下直接放的 .jsonl 文件
        result.push({
          name: entry.name,
          path: join(sessionsDir, entry.name),
          mtime: statSync(join(sessionsDir, entry.name)).mtime,
        });
      }
    }
  } catch {
    // 目录不存在或无法读取
  }
  return result;
}

// listSessions —— 列出所有会话摘要（递归扫描日期子目录）
export function listSessions(projectRoot?: string): SessionSummary[] {
  const dir = ensureSessionsMigrated(projectRoot);
  if (!existsSync(dir)) return [];
  try {
    const files = collectSessionFiles(dir)
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
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
        lastActivityAt: lastMsg?.timestamp ?? f.mtime.toISOString(),
        isCorrupted: hasBad,
        recoverable: messages.length > 0,
        warnings: messages.length === 0 ? ["会话文件为空或全部损坏"] : [],
      };
    });
  } catch {
    return [];
  }
}

// cleanupExpiredSessions —— 清理超过保留期的旧会话（递归扫描日期子目录）
export function cleanupExpiredSessions(
  now: Date,
  retentionDays: number = 30,
  projectRoot?: string,
): BootstrapDiagnostic[] {
  const diagnostics: BootstrapDiagnostic[] = [];
  const dir = ensureSessionsMigrated(projectRoot);
  if (!existsSync(dir)) return diagnostics;
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // 日期子目录：检查其中所有会话文件
        const subDir = join(dir, entry.name);
        let subDirEmpty = true;
        try {
          for (const f of readdirSync(subDir)) {
            if (!f.endsWith(SESSION_EXT)) continue;
            subDirEmpty = false;
            const fp = join(subDir, f);
            const st = statSync(fp);
            if (st.mtimeMs < cutoff) {
              unlinkSync(fp);
              diagnostics.push({
                source: "session",
                level: "info",
                message: `已删除过期会话：${entry.name}/${f}（修改时间：${st.mtime.toISOString()}）`,
                code: "SESSION_EXPIRED_CLEANUP",
              });
            } else {
              subDirEmpty = false;
            }
          }
          // 清理后子目录为空则删除
          if (subDirEmpty || readdirSync(subDir).length === 0) {
            try { rmdirSync(subDir); } catch {}
          }
        } catch {
          // 跳过无法读取的子目录
        }
      } else if (entry.isFile() && entry.name.endsWith(SESSION_EXT)) {
        // 兼容旧格式：sessions 根目录下的文件
        const fp = join(dir, entry.name);
        const st = statSync(fp);
        if (st.mtimeMs < cutoff) {
          unlinkSync(fp);
          diagnostics.push({
            source: "session",
            level: "info",
            message: `已删除过期会话：${entry.name}（修改时间：${st.mtime.toISOString()}）`,
            code: "SESSION_EXPIRED_CLEANUP",
          });
        }
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
