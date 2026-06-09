import type { Message, ChatConfig, Chunk } from "./types.js";
import type { LLMProvider } from "./types.js";
import { parseSSEStream } from "./sse.js";

// OpenAIProvider —— OpenAI Chat Completions API + SSE 流式
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";

  async *streamChat(
    messages: Message[],
    config: ChatConfig,
    signal: AbortSignal,
  ): AsyncIterable<Chunk> {
    const body = this.buildRequestBody(messages, config);
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

    let modelName = body.model as string;

    // 流式解析 SSE
    for await (const chunk of parseSSEStream(response.body, signal)) {
      // 补充模型名到 usage chunk
      if (chunk.type === "usage" && chunk.usage.model === "") {
        chunk.usage.model = modelName;
      }
      yield chunk;
    }
  }

  // buildRequestBody —— 构建 OpenAI API 请求体
  private buildRequestBody(messages: Message[], config: ChatConfig): Record<string, unknown> {
    // OpenAI 支持 system role，直接透传（去掉 thinking 字段）
    const formattedMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    return {
      model: config.model,
      messages: formattedMessages,
      stream: true,
    };
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
