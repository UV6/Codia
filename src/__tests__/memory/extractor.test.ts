import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { extractFromTurn } from "../../memory/extractor.js";
import { upsertNote, listNotes } from "../../memory/store.js";
import type { MemoryExtractionJob, MemoryNote } from "../../memory/types.js";
import type { LLMProvider, ChatConfig, Message, Chunk } from "../../provider/types.js";

// 创建模拟 Provider，通过 text chunk 返回 JSON 记忆操作
function makeTextProvider(jsonOutput: string): LLMProvider {
  async function* stream(): AsyncIterable<Chunk> {
    if (jsonOutput) {
      yield { type: "text", content: jsonOutput };
    }
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

describe("extractFromTurn (text JSON)", () => {
  const projectRoot = join(tmpdir(), "codia-memory-ext-test");
  const previousCodiaHome = process.env.CODIA_HOME;
  let testCodiaHome = join(tmpdir(), "codia-memory-extractor-home", ".codia");

  beforeAll(() => {
    process.env.CODIA_HOME = testCodiaHome;
  });

  afterAll(() => {
    try { rmSync(join(tmpdir(), "codia-memory-extractor-home"), { recursive: true, force: true }); } catch {}
    if (previousCodiaHome === undefined) {
      delete process.env.CODIA_HOME;
    } else {
      process.env.CODIA_HOME = previousCodiaHome;
    }
  });

  function cleanup() {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch {}
    try { rmSync(join(testCodiaHome, ".."), { recursive: true, force: true }); } catch {}
  }
  function setup() {
    cleanup();
    testCodiaHome = join(tmpdir(), `codia-memory-extractor-home-${Date.now()}`, ".codia");
    process.env.CODIA_HOME = testCodiaHome;
    mkdirSync(projectRoot, { recursive: true });
  }

  it("当 LLM 输出 upsert JSON 时应写入笔记", async () => {
    setup();
    const jsonOutput = `一些分析文本…

\`\`\`json
[
  {
    "action": "upsert",
    "category": "user_preference",
    "title": "用中文写 commit message",
    "summary": "每次开发完用中文写 commit message",
    "body": "用户要求每次功能开发完成后用中文编写 git commit message。",
    "reason": "用户明确表达的偏好"
  }
]
\`\`\``;
    const provider = makeTextProvider(jsonOutput);
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

  it("当对话没有可复用内容时 LLM 输出空数组", async () => {
    setup();
    const jsonOutput = `没有值得记录的内容。

\`\`\`json
[]
\`\`\``;
    const provider = makeTextProvider(jsonOutput);
    const job = makeJob({ projectRoot });

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

    const notes = listNotes("project", projectRoot);
    expect(notes.length).toBe(0);

    cleanup();
  });

  it("当 LLM 输出 delete JSON 时应删除已有笔记", async () => {
    setup();
    // 先创建一条笔记
    const existingNote: MemoryNote = {
      id: "pref-1234567890-old",
      scope: "project",
      category: "user_preference",
      title: "旧偏好",
      summary: "旧的偏好",
      body: "旧的偏好内容",
      sourceSessionId: "old-session",
      updatedAt: new Date().toISOString(),
    };
    upsertNote(existingNote, projectRoot);

    // 确认笔记已存在
    expect(listNotes("project", projectRoot).length).toBe(1);

    const jsonOutput = `\`\`\`json
[
  {
    "action": "delete",
    "id": "pref-1234567890-old",
    "reason": "用户已明确推翻之前的偏好"
  }
]
\`\`\``;
    const provider = makeTextProvider(jsonOutput);
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

  it("当 provider 抛出错误时应向上传播", async () => {
    setup();
    const provider = makeErrorProvider();
    const job = makeJob({ projectRoot });

    await expect(
      extractFromTurn(job, messages, provider, mockConfig, new AbortController().signal),
    ).rejects.toThrow("network error");

    const notes = listNotes("project", projectRoot);
    expect(notes.length).toBe(0);

    cleanup();
  });
});
