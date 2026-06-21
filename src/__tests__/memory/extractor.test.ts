import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { extractFromTurn } from "../../memory/extractor.js";
import { listNotes } from "../../memory/store.js";
import type { MemoryExtractionJob } from "../../memory/types.js";
import type { LLMProvider, ChatConfig, Message, Chunk } from "../../provider/types.js";

// 创建模拟 Provider，通过 tool_use chunk 返回记忆操作
function makeMemoryProvider(
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>,
): LLMProvider {
  async function* stream(): AsyncIterable<Chunk> {
    for (const call of toolCalls) {
      yield {
        type: "tool_use",
        call: {
          id: `toolu_${Math.random().toString(36).slice(2, 8)}`,
          name: call.name,
          input: call.input,
        },
      };
    }
    yield { type: "done" };
  }

  return {
    name: "mock",
    streamChat: vi.fn().mockImplementation(() => stream()),
  };
}

// 创建模拟 Provider，返回空（不调用任何 tool）
function makeEmptyProvider(): LLMProvider {
  async function* stream(): AsyncIterable<Chunk> {
    yield { type: "done" };
  }
  return {
    name: "mock",
    streamChat: vi.fn().mockImplementation(() => stream()),
  };
}

// 创建抛出错误的模拟 Provider
function makeErrorProvider(): LLMProvider {
  async function* stream(): AsyncIterable<Chunk> {
    throw new Error("network error");
  }
  return {
    name: "mock",
    streamChat: vi.fn().mockImplementation(() => stream()),
  };
}

function makeJob(overrides: Partial<MemoryExtractionJob> = {}): MemoryExtractionJob {
  return {
    sessionId: "20260621-120000-test",
    turnRange: { start: 0, end: 2 },
    projectRoot: join(tmpdir(), "codia-memory-ext-test"),
    existingMemoryIndex: { project: [], user: [] },
    triggeredAt: new Date().toISOString(),
    ...overrides,
  };
}

const mockConfig: ChatConfig = {
  protocol: "anthropic",
  model: "haiku",
  baseUrl: "https://test.example.com",
  apiKey: "test-key",
};

const messages: Message[] = [
  {
    role: "user",
    content: "以后每次开发完功能，记得用中文写 commit message",
    timestamp: new Date().toISOString(),
  },
  {
    role: "assistant",
    content: "好的，我记住了。以后每次开发完会用中文写 commit message。",
    timestamp: new Date().toISOString(),
  },
];

describe("extractFromTurn", () => {
  const projectRoot = join(tmpdir(), "codia-memory-ext-test");

  function cleanup() {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch {}
  }
  function setup() {
    cleanup();
    mkdirSync(projectRoot, { recursive: true });
  }

  it("当 LLM 调用 memory_upsert 时应写入笔记", async () => {
    setup();
    const provider = makeMemoryProvider([
      {
        name: "memory_upsert",
        input: {
          category: "user_preference",
          title: "用中文写 commit message",
          summary: "每次开发完用中文写 commit message",
          body: "用户要求每次功能开发完成后用中文编写 git commit message。",
          reason: "用户明确表达的偏好",
        },
      },
    ]);
    const job = makeJob({ projectRoot });

    const result = await extractFromTurn(
      job,
      messages,
      provider,
      mockConfig,
      new AbortController().signal,
    );

    expect(result.upserted.length).toBe(1);
    expect(result.upserted[0].category).toBe("user_preference");
    expect(result.upserted[0].title).toBe("用中文写 commit message");

    // 确认已落盘
    const notes = listNotes("project", projectRoot);
    expect(notes.length).toBe(1);
    expect(notes[0].category).toBe("user_preference");

    cleanup();
  });

  it("当对话没有可复用内容时 LLM 不调用工具", async () => {
    setup();
    const provider = makeEmptyProvider();
    const job = makeJob({ projectRoot });

    // 用无意义的对话
    const trivialMessages: Message[] = [
      { role: "user", content: "今天天气怎么样？", timestamp: new Date().toISOString() },
      { role: "assistant", content: "不知道。", timestamp: new Date().toISOString() },
    ];

    const result = await extractFromTurn(
      job,
      trivialMessages,
      provider,
      mockConfig,
      new AbortController().signal,
    );

    expect(result.upserted.length).toBe(0);
    expect(result.deleted.length).toBe(0);

    // 确认没有写入
    const notes = listNotes("project", projectRoot);
    expect(notes.length).toBe(0);

    cleanup();
  });

  it("当 LLM 调用 memory_delete 时应删除已有笔记", async () => {
    setup();
    const provider = makeMemoryProvider([
      {
        name: "memory_delete",
        input: {
          id: "pref-1234567890-old",
          reason: "用户已明确推翻之前的偏好",
        },
      },
    ]);

    const job = makeJob({ projectRoot });
    const result = await extractFromTurn(
      job,
      messages,
      provider,
      mockConfig,
      new AbortController().signal,
    );

    expect(result.deleted.length).toBe(1);
    expect(result.deleted[0]).toBe("pref-1234567890-old");

    cleanup();
  });

  it("当 provider 抛出错误时不应崩溃", async () => {
    setup();
    const provider = makeErrorProvider();
    const job = makeJob({ projectRoot });

    await expect(
      extractFromTurn(job, messages, provider, mockConfig, new AbortController().signal),
    ).rejects.toThrow("network error");

    // 确认没有写入
    const notes = listNotes("project", projectRoot);
    expect(notes.length).toBe(0);

    cleanup();
  });
});
