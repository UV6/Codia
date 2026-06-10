import type { Chunk } from "./types.js";

// parseSSEStream —— 将 ReadableStream<Uint8Array> 解析为 Chunk 的异步迭代器
// 支持 abortSignal 中断
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  abortSignal: AbortSignal,
): AsyncGenerator<Chunk> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader = (body as any).pipeThrough(new TextDecoderStream()).getReader();

  let buffer = "";

  try {
    while (true) {
      // 检查中断信号
      if (abortSignal.aborted) {
        yield { type: "done" };
        return;
      }

      // 并行竞赛：读下一块 vs 中断信号
      const result = await Promise.race([
        reader.read(),
        new Promise<ReadableStreamReadResult<string>>((_, reject) => {
          abortSignal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
      ]);

      if (result.done) break;

      buffer += result.value;

      // 按 \n\n 分割事件
      const parts = buffer.split("\n\n");
      // 最后一个片段可能不完整，保留在 buffer
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const chunk = parseSSEEvent(part);
        if (chunk) yield chunk;
      }
    }

    // 处理剩余 buffer
    if (buffer.trim()) {
      const chunk = parseSSEEvent(buffer);
      if (chunk) yield chunk;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      yield { type: "done" };
      return;
    }
    throw e;
  } finally {
    reader.releaseLock();
  }
}

// parseSSEEvent —— 解析单个 SSE 事件块
// 返回 null 表示该事件应跳过
function parseSSEEvent(raw: string): Chunk | null {
  const lines = raw.split("\n");
  let dataContent = "";

  for (const line of lines) {
    // 跳过注释行和空行
    if (line.startsWith(":") || line.trim() === "") continue;

    if (line.startsWith("data: ")) {
      dataContent += line.slice(6);
    } else if (line.startsWith("data:")) {
      dataContent += line.slice(5);
    }
  }

  if (!dataContent) return null;

  // [DONE] 信号
  if (dataContent.trim() === "[DONE]") {
    return { type: "done" };
  }

  // 解析为 Chunk（由调用方映射）
  try {
    const parsed = JSON.parse(dataContent);
    return mapToChunk(parsed);
  } catch {
    // 非 JSON 数据，忽略
    return null;
  }
}

// mapToChunk —— 将原始 SSE 数据映射为 Chunk
// 此函数负责识别 Anthropic 和 OpenAI 的不同事件格式
// 返回 null 表示无法识别该事件（调用方应跳过）
export function mapToChunk(data: Record<string, unknown>): Chunk | null {
  // Anthropic 事件
  if (data.type) {
    const eventType = data.type as string;

    // content_block_start: 新 block 开始（可能是 tool_use）
    if (eventType === "content_block_start") {
      const block = data.content_block as Record<string, unknown>;
      if (block?.type === "tool_use") {
        return {
          type: "tool_use_start",
          id: block.id as string,
          name: block.name as string,
        };
      }
    }

    if (eventType === "content_block_delta") {
      const delta = data.delta as Record<string, unknown>;
      if (delta.type === "text_delta") {
        return { type: "text", content: delta.text as string };
      }
      if (delta.type === "thinking_delta") {
        return { type: "thinking", content: delta.thinking as string };
      }
      if (delta.type === "input_json_delta") {
        return { type: "tool_input_delta", partialJson: delta.partial_json as string };
      }
    }

    if (eventType === "message_delta") {
      const usage = data.usage as Record<string, number>;
      if (usage) {
        return {
          type: "usage",
          usage: {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            model: "", // Anthropic 消息级 delta 不含 model，由调用方补充
          },
        };
      }
    }

    if (eventType === "message_stop") {
      const usage = (data as Record<string, unknown>).usage as Record<string, number> | undefined;
      if (usage) {
        return {
          type: "usage",
          usage: {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            model: "",
          },
        };
      }
      // message_stop 总是流结束信号
      return { type: "done" };
    }

    if (eventType === "error") {
      const error = data.error as Record<string, unknown>;
      return {
        type: "error",
        error: {
          code: "unknown",
          message: (error?.message as string) ?? "未知错误",
        },
      };
    }
  }

  // OpenAI 事件
  if (data.choices) {
    const choices = data.choices as Array<Record<string, unknown>>;
    const choice = choices[0];
    if (!choice) return { type: "done" };

    const delta = choice.delta as Record<string, unknown> | undefined;
    if (delta?.content) {
      return { type: "text", content: delta.content as string };
    }

    if (choice.finish_reason === "stop") {
      const usage = data.usage as Record<string, number> | undefined;
      if (usage) {
        return {
          type: "usage",
          usage: {
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
            model: (data.model as string) ?? "",
          },
        };
      }
      return { type: "done" };
    }
  }

  // OpenAI 错误
  if (data.error) {
    const error = data.error as Record<string, unknown>;
    return {
      type: "error",
      error: {
        code: "unknown",
        message: (error.message as string) ?? "未知错误",
      },
    };
  }

  // 未识别的数据，返回 null 让调用方跳过
  return null;
}
