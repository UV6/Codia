import { readFileSync, existsSync, appendFileSync } from "node:fs";
import type { Message } from "../provider/types.js";

// HistoryManager —— 对话历史 JSONL 文件管理
const DEFAULT_PATH = "./.codia-history.jsonl";

// loadHistory —— 从 JSONL 文件读取所有消息
// 文件不存在时返回空数组，损坏行跳过并 warn
export function loadHistory(filePath: string = DEFAULT_PATH): Message[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const messages: Message[] = [];
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((line) => line.trim() !== "");

  for (const line of lines) {
    try {
      const msg = JSON.parse(line) as Message;
      // 基本结构校验
      if (msg.role && msg.content) {
        messages.push(msg);
      }
    } catch {
      console.warn(`[HistoryManager] 跳过损坏行：${line.slice(0, 50)}...`);
    }
  }

  return messages;
}

// appendMessage —— 向 JSONL 文件追加一条消息
export function appendMessage(filePath: string = DEFAULT_PATH, msg: Message): void {
  appendFileSync(filePath, JSON.stringify(msg) + "\n", "utf-8");
}

// clearHistory —— 清空历史文件（创建空文件或删除）
export function clearHistory(filePath: string = DEFAULT_PATH): void {
  const { writeFileSync } = require("node:fs") as typeof import("node:fs");
  writeFileSync(filePath, "", "utf-8");
}
