import { describe, it, expect } from "vitest";
import { parseSSEStream, mapToChunk } from "../provider/sse.js";

// 辅助函数：将字符串转为 ReadableStream
function stringToStream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("mapToChunk", () => {
  it("解析 Anthropic text_delta", () => {
    const data = {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "你好" },
    };
    const result = mapToChunk(data);
    expect(result).toEqual({ type: "text", content: "你好" });
  });

  it("解析 Anthropic thinking_delta", () => {
    const data = {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "让我想想..." },
    };
    const result = mapToChunk(data);
    expect(result).toEqual({ type: "thinking", content: "让我想想..." });
  });

  it("解析 Anthropic message_delta (usage)", () => {
    const data = {
      type: "message_delta",
      usage: { output_tokens: 50 },
    };
    const result = mapToChunk(data);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("usage");
    if (result!.type === "usage") {
      expect(result!.usage.outputTokens).toBe(50);
    }
  });

  it("解析 OpenAI delta content", () => {
    const data = {
      choices: [{ delta: { content: "你好" }, index: 0, finish_reason: null }],
    };
    const result = mapToChunk(data);
    expect(result).toEqual({ type: "text", content: "你好" });
  });

  it("解析 OpenAI tool_calls delta", () => {
    const data = {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            type: "function",
            function: {
              name: "LoadSkill",
              arguments: "{\"name\":\"review\"}",
            },
          }],
        },
        index: 0,
        finish_reason: null,
      }],
    };
    const result = mapToChunk(data);
    expect(result).toEqual({
      type: "openai_tool_delta",
      deltas: [{
        index: 0,
        id: "call_1",
        name: "LoadSkill",
        arguments: "{\"name\":\"review\"}",
      }],
    });
  });

  it("解析 OpenAI finish_reason=stop + usage", () => {
    const data = {
      choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
      model: "gpt-4",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };
    const result = mapToChunk(data);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("usage");
    if (result!.type === "usage") {
      expect(result!.usage.inputTokens).toBe(10);
      expect(result!.usage.outputTokens).toBe(20);
    }
  });
});

describe("parseSSEStream", () => {
  it("解析单事件 SSE 流", async () => {
    const data = `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n\n`;
    const stream = stringToStream(data);
    const controller = new AbortController();
    const chunks = [];
    for await (const chunk of parseSSEStream(stream, controller.signal)) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual({ type: "text", content: "你好" });
  });

  it("解析多事件 SSE 流", async () => {
    const event1 = `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}\n\n`;
    const event2 = `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"好"}}\n\n`;
    const event3 = `data: [DONE]\n\n`;
    const stream = stringToStream(event1 + event2 + event3);
    const controller = new AbortController();
    const chunks = [];
    for await (const chunk of parseSSEStream(stream, controller.signal)) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(3);
    expect(chunks[0].type).toBe("text");
    expect(chunks[1].type).toBe("text");
    expect(chunks[2].type).toBe("done");
  });

  it("处理 [DONE] 信号", async () => {
    const stream = stringToStream("data: [DONE]\n\n");
    const controller = new AbortController();
    const chunks = [];
    for await (const chunk of parseSSEStream(stream, controller.signal)) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(1);
    expect(chunks[0].type).toBe("done");
  });

  it("跳过 SSE 注释行", async () => {
    const stream = stringToStream(`:comment\n\n`);
    const controller = new AbortController();
    const chunks = [];
    for await (const chunk of parseSSEStream(stream, controller.signal)) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(0);
  });

  it("中断信号触发后停止", async () => {
    const stream = stringToStream(
      `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}\n\n`,
    );
    const controller = new AbortController();
    // 立即中断
    controller.abort();
    const chunks = [];
    for await (const chunk of parseSSEStream(stream, controller.signal)) {
      chunks.push(chunk);
    }
    // 已经中断，会 yield done
    expect(chunks.some((c) => c.type === "done")).toBe(true);
  });

  it("解析 OpenAI tool_calls SSE 流", async () => {
    const event = `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            type: "function",
            function: {
              name: "LoadSkill",
              arguments: "{\"name\":\"review\"}",
            },
          }],
        },
        index: 0,
        finish_reason: null,
      }],
    })}\n\n`;
    const stream = stringToStream(event);
    const controller = new AbortController();
    const chunks = [];
    for await (const chunk of parseSSEStream(stream, controller.signal)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{
      type: "openai_tool_delta",
      deltas: [{
        index: 0,
        id: "call_1",
        name: "LoadSkill",
        arguments: "{\"name\":\"review\"}",
      }],
    }]);
  });
});
