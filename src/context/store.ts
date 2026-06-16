import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// CONTEXT_DIR —— 上下文压缩文件根目录
const CONTEXT_DIR = join(homedir(), ".Codia", "context");

// ensureDir —— 递归创建目录
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// saveResult —— 将完整工具结果或摘要写入磁盘
// sessionId: 会话标识（如 "2026-06-16-1030"）
// content: 完整内容
// meta: 元数据（type: "tool_result" | "summary", timestamp 等）
// 返回：写入的绝对路径
export function saveResult(
  sessionId: string,
  content: string,
  meta: { type: string; timestamp: string },
): string {
  const dir = join(CONTEXT_DIR, sessionId);
  ensureDir(dir);

  // ISO 8601 格式时间戳保证文件名可排序
  const safeTimestamp = meta.timestamp.replace(/[:.]/g, "-");
  const filename = `result_${safeTimestamp}.json`;
  const filePath = join(dir, filename);

  const data = {
    meta: { type: meta.type, timestamp: meta.timestamp },
    content,
  };

  writeFileSync(filePath, JSON.stringify(data), "utf-8");
  return filePath;
}

// loadResult —— 从磁盘读取已存盘的结果文件
// filePath: saveResult 返回的绝对路径
// 返回：文件的 content 字段
export function loadResult(filePath: string): string {
  const raw = readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as { content: string };
  return data.content;
}
