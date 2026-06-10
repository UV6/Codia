import type { Message, ChatConfig, Chunk } from "../provider/types.js";
import type { ToolCall } from "../tool/types.js";
import { createProvider } from "../provider/factory.js";
import { loadHistory, appendMessage, newSessionPath } from "./history.js";
import { buildMessages } from "./context.js";
import { ToolRegistry } from "../tool/registry.js";
import { executeTool } from "../tool/executor.js";
import { readFileTool } from "../tool/tools/read-file.js";
import { writeFileTool } from "../tool/tools/write-file.js";
import { editFileTool } from "../tool/tools/edit-file.js";
import { globTool } from "../tool/tools/glob.js";
import { grepTool } from "../tool/tools/grep.js";
import { runCommandTool } from "../tool/tools/run-command.js";

// 最多一次工具调用循环
const MAX_TOOL_ROUNDS = 1;

// ChatService —— 对话核心，串联历史、上下文、Provider、工具
export class ChatService {
  private provider;
  private config: ChatConfig;
  private historyPath: string;
  private messages: Message[] = [];
  private abortController: AbortController | null = null;
  private registry: ToolRegistry;

  onUsage: ((usage: { inputTokens: number; outputTokens: number; model: string }) => void) | null =
    null;

  constructor(config: ChatConfig, historyPath: string = newSessionPath()) {
    this.config = config;
    this.historyPath = historyPath;
    this.provider = createProvider(config);
    this.messages = loadHistory(historyPath);

    // 注册六个核心工具
    this.registry = new ToolRegistry();
    this.registry.register(readFileTool);
    this.registry.register(writeFileTool);
    this.registry.register(editFileTool);
    this.registry.register(globTool);
    this.registry.register(grepTool);
    this.registry.register(runCommandTool);
  }

  get history(): Message[] {
    return [...this.messages];
  }

  // getToolMetas —— 生成 API 格式的工具列表
  getToolMetas(): Record<string, unknown>[] {
    return this.registry.getAllMetas() as unknown as Record<string, unknown>[];
  }

  async *sendMessage(text: string): AsyncIterable<Chunk> {
    this.cancel();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const tools = this.getToolMetas();

    // 用户消息
    const userMsg: Message = {
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(userMsg);
    appendMessage(this.historyPath, userMsg);

    let toolRound = 0;

    while (toolRound <= MAX_TOOL_ROUNDS) {
      // 构建 API 消息列表
      const apiMessages =
        toolRound === 0
          ? buildMessages(
              this.messages.slice(0, -1), // 除去刚加的 userMsg
              text,
            )
          : [
              ...this.messages.filter((m) => m.role !== "system"), // 系统消息不重复
            ];

      // 加回 system
      const systemMsg = this.messages.find((m) => m.role === "system");
      if (!systemMsg && toolRound > 0) {
        // 手动构造 system
        apiMessages.unshift({
          role: "system",
          content: "You are Codia, a helpful CLI AI assistant.",
          timestamp: new Date().toISOString(),
        });
      }

      let fullContent = "";
      let thinkingContent = "";
      let usage: Chunk & { type: "usage" } | null = null;
      let hadError = false;
      let toolCalls: ToolCall[] = [];
      let assistantSaved = false;

      try {
        const stream =
          toolRound === 0 || tools.length > 0
            ? this.provider.streamChat(apiMessages, this.config, signal, tools)
            : this.provider.streamChat(apiMessages, this.config, signal);

        for await (const chunk of stream) {
          switch (chunk.type) {
            case "text":
              fullContent += chunk.content;
              yield chunk;
              break;

            case "thinking":
              thinkingContent += chunk.content;
              yield chunk;
              break;

            case "tool_use":
              toolCalls.push(chunk.call);
              yield {
                type: "tool_status",
                name: chunk.call.name,
                param: JSON.stringify(chunk.call.input).slice(0, 80),
              };
              yield chunk;
              break;

            case "tool_status":
              yield chunk;
              break;

            case "usage":
              usage = chunk;
              if (this.onUsage) this.onUsage(chunk.usage);
              yield chunk;
              break;

            case "error":
              hadError = true;
              yield chunk;
              break;

            case "done":
              if (!hadError && !assistantSaved && fullContent && toolCalls.length === 0) {
                assistantSaved = true;
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
        yield {
          type: "error",
          error: { code: "network", message: (e as Error).message },
        };
        break;
      }

      // 没有工具调用 → 结束
      if (toolCalls.length === 0) {
        // 兜底保存（如果上面的 done 没触发）
        if (!hadError && !assistantSaved && fullContent) {
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
        break;
      }

      // 有工具调用 → 保存 assistant(tool_use) 消息
      const toolAssistantMsg: Message = {
        role: "assistant",
        content: fullContent,
        timestamp: new Date().toISOString(),
        toolCalls,
        usage: usage?.usage,
      };
      this.messages.push(toolAssistantMsg);
      appendMessage(this.historyPath, toolAssistantMsg);

      // 执行工具（只取第一个 tool_use）
      const firstCall = toolCalls[0];
      const context = { cwd: process.cwd(), signal };
      const { result } = await executeTool(firstCall, context, this.registry);

      // 展示工具结果状态
      yield {
        type: "tool_status",
        name: firstCall.name,
        param: result.status === "success" ? "完成" : "失败",
      };

      // 工具结果作为 user 消息加入历史
      const toolResultMsg: Message = {
        role: "user",
        content: result.content,
        timestamp: new Date().toISOString(),
        toolResult: result,
        toolUseId: firstCall.id,
      };
      this.messages.push(toolResultMsg);
      appendMessage(this.historyPath, toolResultMsg);

      toolRound++;

      // 达到最大轮数 → 收到工具结果后模型给最终回复
      // 重置，进入下一轮 while（最多再一轮）
    }

    this.abortController = null;
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
