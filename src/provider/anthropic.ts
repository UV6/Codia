import type { Message, ChatConfig, Chunk } from "./types.js";
import type { LLMProvider } from "./types.js";
import { parseSSEStream } from "./sse.js";

// AnthropicProvider —— Anthropic Messages API + SSE 流式
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";

  async *streamChat(
    messages: Message[],
    config: ChatConfig,
    signal: AbortSignal,
  ): AsyncIterable<Chunk> {
    const body = this.buildRequestBody(messages, config);
    const url = `${config.baseUrl}/v1/messages`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
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

    let modelName = body.model as string;

    // 流式解析 SSE
    for await (const chunk of parseSSEStream(response.body, signal)) {
      // 补充模型名到 usage chunk
      if (chunk.type === "usage" || chunk.type === "text") {
        if (chunk.type === "usage" && chunk.usage.model === "") {
          chunk.usage.model = modelName;
        }
      }
      yield chunk;
    }
  }

  // buildRequestBody —— 构建 Anthropic API 请求体
  private buildRequestBody(messages: Message[], config: ChatConfig): Record<string, unknown> {
    // 分离 system prompt
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: 4096,
      messages: conversationMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    };

    // system 消息作为顶层字段
    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => ({ type: "text", text: m.content }));
    }

    // extended thinking 支持
    const thinkingEnabled = (config as unknown as Record<string, unknown>).thinking !== false;
    if (thinkingEnabled) {
      body.thinking = {
        type: "enabled",
        budget_tokens: 4000,
      };
    }

    return body;
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
