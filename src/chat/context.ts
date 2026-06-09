import type { Message } from "../provider/types.js";

// 内置默认 system prompt
const DEFAULT_SYSTEM_PROMPT = "You are Codia, a helpful CLI AI assistant. Answer concisely.";

// buildMessages —— 拼接完整的消息列表发给 LLM API
// 输出：[system, ...history(去thinking), user(newMsg)]
export function buildMessages(
  history: Message[],
  newUserMsg: string,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
): Message[] {
  const result: Message[] = [
    {
      role: "system",
      content: systemPrompt,
      timestamp: new Date().toISOString(),
    },
  ];

  // 历史消息去掉 thinking 字段（不需要发给 API）
  for (const msg of history) {
    const { thinking, ...rest } = msg as Message & { thinking?: string };
    result.push(rest);
  }

  // 新用户消息
  result.push({
    role: "user",
    content: newUserMsg,
    timestamp: new Date().toISOString(),
  });

  return result;
}
