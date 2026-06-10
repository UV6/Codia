import { describe, it, expect } from "vitest";
import { AgentLoop } from "../../agent/loop.js";
import type { Message, ChatConfig, LLMProvider, Chunk } from "../../provider/types.js";
import type { Tool, ToolContext, ToolInputSchema } from "../../tool/types.js";
import type { ToolRegistry } from "../../tool/registry.js";
import type { AgentEvent, StopReason } from "../../agent/types.js";

// Mock LLMProvider —— 返回预设 Chunk 序列，支持多轮不同响应
class MockProvider implements LLMProvider {
  readonly name = "mock";
  private rounds: Chunk[][];
  private callCount = 0;
  public lastMessages?: Message[];
  public lastTools?: Record<string, unknown>[];

  // 传入 Chunk[][] 时，每轮消费一个；传入 Chunk[] 时，每轮都返回相同的
  constructor(chunks: Chunk[] | Chunk[][]) {
    if (chunks.length > 0 && Array.isArray(chunks[0])) {
      this.rounds = chunks as Chunk[][];
    } else {
      // 每轮都返回相同序列
      this.rounds = [chunks as Chunk[]];
    }
  }

  async *streamChat(
    messages: Message[],
    _config: ChatConfig,
    _signal: AbortSignal,
    tools?: Record<string, unknown>[],
  ): AsyncIterable<Chunk> {
    this.lastMessages = messages;
    this.lastTools = tools;
    const roundChunks = this.rounds[this.callCount] ?? this.rounds[this.rounds.length - 1];
    this.callCount++;
    for (const c of roundChunks) yield c;
  }
}

// 简单内存 ToolRegistry
class TestRegistry implements Pick<ToolRegistry, "get" | "getAll" | "getAllMetas" | "getMetasByTools"> {
  private tools: Tool[];
  constructor(tools: Tool[]) {
    this.tools = tools;
  }
  get(name: string) { return this.tools.find((t) => t.name === name); }
  getAll() { return this.tools; }
  getAllMetas() { return this.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })); }
  getMetasByTools(tools: Tool[]) { return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })); }
}

function makeTool(overrides: Partial<Tool>): Tool {
  const schema: ToolInputSchema = { type: "object", properties: {} };
  return {
    name: "test",
    description: "desc",
    type: "file",
    readOnly: true,
    destructive: false,
    inputSchema: schema,
    execute: async () => ({ status: "success", content: "ok" }),
    ...overrides,
  };
}

const chatConfig: ChatConfig = {
  protocol: "anthropic",
  model: "test-model",
  baseUrl: "http://mock",
  apiKey: "mock-key",
};

function createSignal(): { signal: AbortSignal; controller: AbortController } {
  const controller = new AbortController();
  return { signal: controller.signal, controller };
}

// Helper: 消费 AgentLoop 事件流，收集事件
async function collectEvents(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of iter) events.push(e);
  return events;
}

describe("AgentLoop", () => {
  it("纯文本响应 → 一轮结束，stop reason = done", async () => {
    const provider = new MockProvider([
      { type: "text", content: "Hello!" },
      { type: "done" },
    ]);
    const registry = new TestRegistry([]) as unknown as ToolRegistry;
    const loop = new AgentLoop(registry);
    const messages: Message[] = [];

    const { signal } = createSignal();
    const events = await collectEvents(
      loop.run(messages, provider, chatConfig, { maxRounds: 5, mode: "full" }, signal),
    );

    expect(events.map((e) => e.type)).toEqual(["round_start", "text", "done", "stopped"]);
    const stopped = events[events.length - 1] as { type: "stopped"; reason: StopReason };
    expect(stopped.reason).toBe("done");

    // 验证最终消息已保存
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].content).toBe("Hello!");
  });

  it("文本 + tool_use → 工具执行后继续，最终 done", async () => {
    // 第一轮：返回 tool_use；第二轮：返回纯文本结束
    const provider = new MockProvider([
      [
        { type: "text", content: "Let me read." },
        { type: "tool_use", call: { id: "t1", name: "read_file", input: { filePath: "a.txt" } } },
        { type: "done" },
      ],
      [
        { type: "text", content: "Done reading!" },
        { type: "done" },
      ],
    ]);

    const readTool = makeTool({
      name: "read_file",
      readOnly: true,
      destructive: false,
      execute: async () => ({ status: "success", content: "file content here" }),
    });

    const registry = new TestRegistry([readTool]) as unknown as ToolRegistry;
    const loop = new AgentLoop(registry);
    const messages: Message[] = [];

    const { signal } = createSignal();
    const events = await collectEvents(
      loop.run(messages, provider, chatConfig, { maxRounds: 5, mode: "full" }, signal),
    );

    // 应有 tool_use 和 tool_result 事件，然后 stopped
    const types = events.map((e) => e.type);
    expect(types).toContain("tool_use");
    expect(types).toContain("tool_result");
    expect(types).toContain("stopped");

    const stopped = events[events.length - 1] as { type: "stopped"; reason: StopReason };
    expect(stopped.reason).toBe("done");

    // 验证消息历史：assistant(tool_use) + tool_result(user) + assistant(final)
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(messages[1].role).toBe("user");
    expect(messages[1].toolResult).toBeDefined();
    expect(messages[2].role).toBe("assistant");
    expect(messages[2].content).toBe("Done reading!");
  });

  it("达到 maxRounds → stop reason = max_rounds", async () => {
    // 每轮都返回一个 tool_use，永远不结束
    const chunks: Chunk[] = [
      { type: "tool_use", call: { id: "t1", name: "dummy", input: {} } },
      { type: "done" },
    ];

    const provider = new MockProvider(chunks);

    const dummyTool = makeTool({
      name: "dummy",
      readOnly: true,
      destructive: false,
      execute: async () => ({ status: "success", content: "ok" }),
    });

    const registry = new TestRegistry([dummyTool]) as unknown as ToolRegistry;
    const loop = new AgentLoop(registry);
    const messages: Message[] = [];

    const { signal } = createSignal();
    const events = await collectEvents(
      loop.run(messages, provider, chatConfig, { maxRounds: 2, mode: "full" }, signal),
    );

    const stopped = events[events.length - 1] as { type: "stopped"; reason: StopReason };
    expect(stopped.reason).toBe("max_rounds");

    // 应该有 2 个 round_start 事件
    const roundStarts = events.filter((e) => e.type === "round_start");
    expect(roundStarts).toHaveLength(2);
  });

  it("取消信号 → stop reason = cancelled", async () => {
    const provider = new MockProvider([
      { type: "text", content: "Starting..." },
      { type: "tool_use", call: { id: "t1", name: "read_file", input: {} } },
      { type: "done" },
    ]);

    const readTool = makeTool({
      name: "read_file",
      readOnly: true,
      destructive: false,
      execute: async () => {
        // 模拟长时间执行，但这里我们只在第一轮结束后取消
        return { status: "success", content: "ok" };
      },
    });

    const registry = new TestRegistry([readTool]) as unknown as ToolRegistry;
    const loop = new AgentLoop(registry);
    const messages: Message[] = [];

    const { signal, controller } = createSignal();

    // 第一轮完成后取消
    let round = 0;
    const events: AgentEvent[] = [];
    const gen = loop.run(messages, provider, chatConfig, { maxRounds: 10, mode: "full" }, signal);

    for await (const event of gen) {
      events.push(event);
      if (event.type === "round_end") {
        round++;
        if (round === 1) {
          controller.abort();
        }
      }
    }

    const stopped = events[events.length - 1] as { type: "stopped"; reason: StopReason };
    expect(stopped.reason).toBe("cancelled");
  });

  it("所有工具都不存在 → stop reason = unknown_tool", async () => {
    const provider = new MockProvider([
      { type: "tool_use", call: { id: "t1", name: "ghost_tool", input: {} } },
      { type: "done" },
    ]);

    const registry = new TestRegistry([]) as unknown as ToolRegistry;
    const loop = new AgentLoop(registry);
    const messages: Message[] = [];

    const { signal } = createSignal();
    const events = await collectEvents(
      loop.run(messages, provider, chatConfig, { maxRounds: 5, mode: "full" }, signal),
    );

    const stopped = events[events.length - 1] as { type: "stopped"; reason: StopReason };
    expect(stopped.reason).toBe("unknown_tool");
  });

  it("流错误 → stop reason = stream_error", async () => {
    const provider = new MockProvider([
      { type: "text", content: "I'll try..." },
      { type: "error", error: { code: "network", message: "Connection lost" } },
      { type: "done" },
    ]);

    const registry = new TestRegistry([]) as unknown as ToolRegistry;
    const loop = new AgentLoop(registry);
    const messages: Message[] = [];

    const { signal } = createSignal();
    const events = await collectEvents(
      loop.run(messages, provider, chatConfig, { maxRounds: 5, mode: "full" }, signal),
    );

    const stopped = events[events.length - 1] as { type: "stopped"; reason: StopReason };
    expect(stopped.reason).toBe("stream_error");
  });

  it("plan mode 下只传递只读工具的 meta", async () => {
    const provider = new MockProvider([
      { type: "text", content: "Here is my plan." },
      { type: "done" },
    ]);

    const readTool = makeTool({ name: "read_file", readOnly: true });
    const writeTool = makeTool({ name: "write_file", readOnly: false, destructive: true });
    const registry = new TestRegistry([readTool, writeTool]) as unknown as ToolRegistry;
    const loop = new AgentLoop(registry);
    const messages: Message[] = [];

    const { signal } = createSignal();
    await collectEvents(
      loop.run(messages, provider, chatConfig, { maxRounds: 5, mode: "plan" }, signal),
    );

    // 验证传给 provider 的 tools 只包含只读工具
    expect(provider.lastTools).toBeDefined();
    expect(provider.lastTools).toHaveLength(1);
    expect(provider.lastTools![0].name).toBe("read_file");
  });

  it("部分工具不存在但其他执行成功 → 不触发 unknown_tool", async () => {
    // 第一轮：两种工具调用（一个存在、一个不存在）
    // 第二轮：模型看到结果后续写文本，自然结束
    const provider = new MockProvider([
      [
        { type: "tool_use", call: { id: "t1", name: "read_file", input: {} } },
        { type: "tool_use", call: { id: "t2", name: "ghost", input: {} } },
        { type: "done" },
      ],
      [
        { type: "text", content: "Only one tool worked, let me continue." },
        { type: "done" },
      ],
    ]);

    const readTool = makeTool({
      name: "read_file",
      readOnly: true,
      destructive: false,
      execute: async () => ({ status: "success", content: "file content" }),
    });

    const registry = new TestRegistry([readTool]) as unknown as ToolRegistry;
    const loop = new AgentLoop(registry);
    const messages: Message[] = [];

    const { signal } = createSignal();
    const events = await collectEvents(
      loop.run(messages, provider, chatConfig, { maxRounds: 5, mode: "full" }, signal),
    );

    // 部分工具存在 → unknown_tool 不触发，循环继续
    const stopped = events[events.length - 1] as { type: "stopped"; reason: StopReason };
    // 第二轮应该自然结束（done）
    expect(stopped.reason).toBe("done");
  });
});
