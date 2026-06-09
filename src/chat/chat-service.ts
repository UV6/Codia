import type { Message, ChatConfig, Chunk } from "../provider/types.js";
import { createProvider } from "../provider/factory.js";
import { loadHistory, appendMessage } from "./history.js";
import { buildMessages } from "./context.js";

// ChatService —— 对话核心，串联历史、上下文、Provider
export class ChatService {
  private provider;
  private config: ChatConfig;
  private historyPath: string;
  private messages: Message[] = [];
  private abortController: AbortController | null = null;

  // onUsage 回调：每次收到 usage chunk 时调用
  onUsage: ((usage: { inputTokens: number; outputTokens: number; model: string }) => void) | null = null;

  constructor(config: ChatConfig, historyPath: string = "./.codia-history.jsonl") {
    this.config = config;
    this.historyPath = historyPath;
    this.provider = createProvider(config);
    this.messages = loadHistory(historyPath);
  }

  // history getter —— 返回当前会话的所有消息
  get history(): Message[] {
    return [...this.messages];
  }

  // sendMessage —— 发送用户消息，返回流式 Chunk 迭代器
  async *sendMessage(text: string): AsyncIterable<Chunk> {
    // 取消之前的请求（如果有）
    this.cancel();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // 拼接上下文
    const apiMessages = buildMessages(this.messages, text);

    // 创建用户消息并写入历史
    const userMsg: Message = {
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(userMsg);
    appendMessage(this.historyPath, userMsg);

    let fullContent = "";
    let thinkingContent = "";
    let usage: Chunk & { type: "usage" } | null = null;
    let hadError = false;
    let assistantSaved = false;

    try {
      for await (const chunk of this.provider.streamChat(apiMessages, this.config, signal)) {
        switch (chunk.type) {
          case "text":
            fullContent += chunk.content;
            yield chunk;
            break;

          case "thinking":
            thinkingContent += chunk.content;
            yield chunk;
            break;

          case "usage":
            usage = chunk;
            if (this.onUsage) {
              this.onUsage(chunk.usage);
            }
            yield chunk;
            break;

          case "error":
            hadError = true;
            yield chunk;
            break;

          case "done":
            if (!hadError && !assistantSaved) {
              assistantSaved = true;
              // 组装 assistant 消息并写入历史
              const assistantMsg: Message = {
                role: "assistant",
                content: fullContent,
                timestamp: new Date().toISOString(),
                usage: usage?.usage,
                ...(thinkingContent ? { thinking: thinkingContent } : {}),
              };
              this.messages.push(assistantMsg);
              appendMessage(this.historyPath, assistantMsg);
            }
            yield chunk;
            break;
        }
      }
    } catch (e) {
      // fork 网络异常
      yield {
        type: "error",
        error: { code: "network", message: (e as Error).message },
      };
    } finally {
      this.abortController = null;
    }
  }

  // cancel —— 中断当前流式请求
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
