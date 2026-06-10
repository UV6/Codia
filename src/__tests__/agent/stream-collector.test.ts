import { describe, it, expect } from "vitest";
import { StreamCollector } from "../../agent/stream-collector.js";
import type { Chunk } from "../../provider/types.js";

// Helper: 创建模拟 Chunk AsyncIterable
async function* makeStream(chunks: Chunk[]): AsyncIterable<Chunk> {
  for (const c of chunks) yield c;
}

describe("StreamCollector", () => {
  it("纯文本流 → fullText 完整拼接", async () => {
    const stream = makeStream([
      { type: "text", content: "Hello " },
      { type: "text", content: "World" },
      { type: "done" },
    ]);
    const collector = new StreamCollector(stream);

    const received: string[] = [];
    for await (const event of collector) {
      if (event.type === "text") received.push(event.content);
    }

    const result = collector.getResult();
    expect(result.fullText).toBe("Hello World");
    expect(result.toolCalls).toEqual([]);
    expect(result.hadError).toBe(false);
    expect(received).toEqual(["Hello ", "World"]);
  });

  it("含 tool_use 的流 → toolCalls 收集正确", async () => {
    const stream = makeStream([
      { type: "text", content: "Let me check." },
      { type: "tool_use", call: { id: "tool_1", name: "read_file", input: { filePath: "a.txt" } } },
      { type: "tool_use", call: { id: "tool_2", name: "grep", input: { pattern: "foo" } } },
      { type: "done" },
    ]);
    const collector = new StreamCollector(stream);

    for await (const _event of collector) {
      // consume
    }

    const result = collector.getResult();
    expect(result.fullText).toBe("Let me check.");
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].id).toBe("tool_1");
    expect(result.toolCalls[1].id).toBe("tool_2");
  });

  it("每个 chunk 都被实时转发", async () => {
    const stream = makeStream([
      { type: "text", content: "a" },
      { type: "text", content: "b" },
      { type: "done" },
    ]);
    const collector = new StreamCollector(stream);

    const types: string[] = [];
    for await (const event of collector) {
      types.push(event.type);
    }

    expect(types).toEqual(["text", "text", "done"]);
  });

  it("流中有 error 事件 → hadError 为 true", async () => {
    const stream = makeStream([
      { type: "text", content: "Trying..." },
      { type: "error", error: { code: "network", message: "Connection lost" } },
      { type: "done" },
    ]);
    const collector = new StreamCollector(stream);

    for await (const _event of collector) {
      // consume
    }

    const result = collector.getResult();
    expect(result.hadError).toBe(true);
    expect(result.fullText).toBe("Trying..."); // error 之前的文本保留
  });

  it("多文本块 + 多 tool_use 交错 → 转发和收集同时正确", async () => {
    const stream = makeStream([
      { type: "text", content: "I will " },
      { type: "tool_use", call: { id: "t1", name: "read_file", input: {} } },
      { type: "text", content: "read and " },
      { type: "tool_use", call: { id: "t2", name: "grep", input: {} } },
      { type: "text", content: "search" },
      { type: "done" },
    ]);
    const collector = new StreamCollector(stream);

    const eventTypes: string[] = [];
    for await (const event of collector) {
      eventTypes.push(event.type);
    }

    // 验证转发顺序
    expect(eventTypes).toEqual([
      "text", "tool_use", "text", "tool_use", "text", "done",
    ]);

    const result = collector.getResult();
    expect(result.fullText).toBe("I will read and search");
    expect(result.toolCalls).toHaveLength(2);
  });

  it("getResult() 在未消费完毕时抛出", () => {
    const stream = makeStream([{ type: "text", content: "hi" }, { type: "done" }]);
    const collector = new StreamCollector(stream);
    expect(() => collector.getResult()).toThrow("尚未消费完毕");
  });

  it("重复迭代抛出异常", async () => {
    const stream = makeStream([{ type: "done" }]);
    const collector = new StreamCollector(stream);
    for await (const _ of collector) { /* consume */ }
    await expect(async () => {
      for await (const _ of collector) { /* should throw */ }
    }).rejects.toThrow("已消费完毕");
  });
});
