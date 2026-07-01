import type { Message, ChatConfig, Chunk } from "./types.js";
import type { LLMProvider } from "./types.js";
import { parseSSEStream } from "./sse.js";
import type { ToolCall, ToolMeta } from "../tool/types.js";

// OpenAIProvider —— OpenAI Chat Completions API + SSE 流式
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";

  async *streamChat(
    messages: Message[],
    config: ChatConfig,
    signal: AbortSignal,
    tools?: Record<string, unknown>[],
    systemPrompt?: string,
  ): AsyncIterable<Chunk> {
    const body = this.buildRequestBody(messages, config, tools, systemPrompt);
    const url = `${config.baseUrl}/v1/chat/completions`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        yield { type: "done" };
        return;
      }
      yield {
        type: "error",
        error: { code: "network", message: `无法连接到 API 服务器：${(e as Error).message}` },
      };
      return;
    }

    // 处理 HTTP 错误
    if (!response.ok) {
      const errorChunk = await this.mapHttpError(response);
      yield errorChunk;
      return;
    }

    if (!response.body) {
      yield { type: "error", error: { code: "unknown", message: "响应体为空" } };
      return;
    }

    const modelName = body.model as string;
    const pendingTools = new Map<number, {
      id: string;
      name: string;
      argumentsJson: string;
      statusSent: boolean;
    }>();

    // 流式解析 SSE
    for await (const chunk of parseSSEStream(response.body, signal)) {
      if (chunk.type === "openai_tool_delta") {
        for (const delta of chunk.deltas) {
          const pending = pendingTools.get(delta.index) ?? {
            id: `openai-tool-${delta.index}`,
            name: "",
            argumentsJson: "",
            statusSent: false,
          };

          if (delta.id) pending.id = delta.id;
          if (delta.name) pending.name = delta.name;
          if (delta.arguments) pending.argumentsJson += delta.arguments;

          if (pending.name && !pending.statusSent) {
            yield { type: "tool_status", name: pending.name, param: "" };
            pending.statusSent = true;
          }

          pendingTools.set(delta.index, pending);
        }
        continue;
      }

      if (pendingTools.size > 0) {
        yield* this.flushPendingTools(pendingTools);
      }

      // 补充模型名到 usage chunk
      if (chunk.type === "usage" && chunk.usage.model === "") {
        chunk.usage.model = modelName;
      }
      yield chunk;
    }

    if (pendingTools.size > 0) {
      yield* this.flushPendingTools(pendingTools);
    }
  }

  // buildRequestBody —— 构建 OpenAI API 请求体
  private buildRequestBody(
    messages: Message[],
    config: ChatConfig,
    tools?: Record<string, unknown>[],
    systemPrompt?: string,
  ): Record<string, unknown> {
    // 如果 systemPrompt 非空，在 messages 头部插入 system role 消息
    const sourceMessages = (systemPrompt
      ? [{ role: "system" as const, content: systemPrompt, timestamp: "" }, ...messages]
      : messages);
    const formattedMessages: Record<string, unknown>[] = [];
    for (const m of sourceMessages) {
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        formattedMessages.push({
          role: "assistant",
          content: m.content || "",
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            },
          })),
        });
        continue;
      }

      if (m.role === "user" && m.toolResults && m.toolResults.length > 0) {
        for (const tr of m.toolResults) {
          formattedMessages.push({
            role: "tool",
            tool_call_id: tr.toolUseId,
            content: tr.result.content,
          });
        }
        continue;
      }

      if (m.role === "user" && m.toolResult) {
        formattedMessages.push({
          role: "tool",
          tool_call_id: m.toolUseId ?? "",
          content: m.toolResult.content,
        });
        continue;
      }

      formattedMessages.push({
        role: m.role,
        content: m.content,
      });
    }

    const body: Record<string, unknown> = {
      model: config.model,
      messages: formattedMessages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (tools && tools.length > 0) {
      body.tools = this.toOpenAITools(tools as unknown as ToolMeta[]);
      body.tool_choice = "auto";
    }

    return body;
  }

  private toOpenAITools(tools: ToolMeta[]): Array<Record<string, unknown>> {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }

  private *flushPendingTools(
    pendingTools: Map<number, { id: string; name: string; argumentsJson: string }>,
  ): Generator<Chunk> {
    const orderedTools = Array.from(pendingTools.entries()).sort((a, b) => a[0] - b[0]);
    pendingTools.clear();

    for (const [, pending] of orderedTools) {
      if (!pending.name) continue;

      let input: Record<string, unknown> = {};
      try {
        input = pending.argumentsJson ? JSON.parse(pending.argumentsJson) as Record<string, unknown> : {};
      } catch {
        // JSON 解析失败时保留空对象，避免中断主流程
      }

      const call: ToolCall = { id: pending.id, name: pending.name, input };
      yield { type: "tool_use", call };
    }
  }

  // mapHttpError —— 将 HTTP 错误响应转换为 error chunk
  private async mapHttpError(response: Response): Promise<Chunk> {
    let apiMessage = "";
    try {
      const errBody = await response.json();
      apiMessage = (errBody as Record<string, unknown>).error
        ? ((errBody as Record<string, unknown>).error as Record<string, unknown>).message as string
        : "";
    } catch {
      // 无法解析错误体
    }

    const code =
      response.status === 401 ? "auth" :
      response.status === 429 ? "rate_limit" :
      "unknown";

    return {
      type: "error",
      error: {
        code,
        message: apiMessage || `API 错误 (${response.status})`,
      },
    };
  }
}
