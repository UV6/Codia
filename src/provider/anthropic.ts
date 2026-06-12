import type { Message, ChatConfig, Chunk, LLMProvider } from "./types.js";
import { parseSSEStream } from "./sse.js";
import type { ToolCall } from "../tool/types.js";

// AnthropicProvider —— Anthropic Messages API + SSE 流式
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";

  async *streamChat(
    messages: Message[],
    config: ChatConfig,
    signal: AbortSignal,
    tools?: Record<string, unknown>[],
    systemPrompt?: string,
  ): AsyncIterable<Chunk> {
    const body = this.buildRequestBody(messages, config, tools, systemPrompt);
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

    // 工具调用状态：累积 tool_use_start + tool_input_delta
    let pendingTool: { id: string; name: string; inputJson: string } | null = null;

    for await (const chunk of parseSSEStream(response.body, signal)) {
      // 累积 tool_use JSON 碎片
      if (chunk.type === "tool_use_start") {
        // 之前的 tool 已完整 → 提交
        if (pendingTool && pendingTool.inputJson) {
          yield* this.emitToolCall(pendingTool, modelName);
        }
        pendingTool = { id: chunk.id, name: chunk.name, inputJson: "" };
        yield { type: "tool_status", name: chunk.name, param: "" };
        continue;
      }

      if (chunk.type === "tool_input_delta") {
        if (pendingTool) {
          pendingTool.inputJson += chunk.partialJson;
        }
        continue;
      }

      // 非 tool 事件到达 → 之前的 tool 输入已完成
      if (pendingTool && pendingTool.inputJson) {
        yield* this.emitToolCall(pendingTool, modelName);
        pendingTool = null;
      }

      // usage chunk 补充模型名
      if (chunk.type === "usage" && chunk.usage.model === "") {
        chunk.usage.model = modelName;
      }

      yield chunk;
    }

    // 流结束时提交未决的 tool
    if (pendingTool && pendingTool.inputJson) {
      yield* this.emitToolCall(pendingTool, modelName);
    }
  }

  // 提交完整的 tool_use call
  private *emitToolCall(
    pending: { id: string; name: string; inputJson: string },
    modelName: string,
  ): Generator<Chunk> {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(pending.inputJson);
    } catch {
      // JSON 解析失败，使用原始 JSON 字符串
    }

    const call: ToolCall = { id: pending.id, name: pending.name, input };
    yield { type: "tool_use", call };
  }

  // buildRequestBody —— 构建 Anthropic API 请求体
  private buildRequestBody(
    messages: Message[],
    config: ChatConfig,
    tools?: Record<string, unknown>[],
    systemPrompt?: string,
  ): Record<string, unknown> {
    // 转换消息为 Anthropic 格式（调用方保证 messages 不含 system role）
    const formattedMessages = messages.map((m) => {
      // assistant 消息含 toolCalls → 构建 content blocks
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const blocks: Record<string, unknown>[] = [];
        if (m.content) {
          blocks.push({ type: "text", text: m.content });
        }
        for (const tc of m.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
        return { role: "assistant", content: blocks };
      }

      // user 消息含 toolResult → tool_result content
      if (m.role === "user" && m.toolResult) {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.toolUseId ?? "",
              content: m.toolResult.content,
            },
          ],
        };
      }

      // 普通消息
      return { role: m.role, content: m.content };
    });

    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: 4096,
      messages: formattedMessages,
      stream: true,
    };

    // systemPrompt 直接放入 system 数组（稳定内容，缓存友好）
    if (systemPrompt) {
      body.system = [{ type: "text", text: systemPrompt }];
    }

    // 工具列表
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    // extended thinking（有工具时不启用 thinking）
    const thinkingEnabled = (config as unknown as Record<string, unknown>).thinking !== false;
    if (thinkingEnabled && !tools?.length) {
      body.thinking = { type: "enabled", budget_tokens: 4000 };
    }

    return body;
  }

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
      error: { code, message: apiMessage || `API 错误 (${response.status})` },
    };
  }
}
