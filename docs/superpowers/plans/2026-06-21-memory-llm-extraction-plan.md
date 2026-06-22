# Memory LLM Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将记忆提取从关键词启发式替换为 LLM + tool call 方案

**Architecture:** 每轮 AgentLoop 结束后，用独立的轻量 LLM 调用分析本轮对话，LLM 通过 `memory_upsert` / `memory_delete` 两个 tool 输出记忆操作，代码只负责落盘。已有记忆索引传入 LLM 用于去重和更新判断。

**Tech Stack:** TypeScript, vitest, 复用现有 LLMProvider 接口

## Global Constraints

- 提取失败只记日志，不阻塞主对话
- 不改 store.ts 的接口
- 不改 types.ts 的结构体定义（仅新增 tool schema）
- 代码风格匹配现有 pattern（中文注释、命名约定）
- 默认 model 为 `haiku`，可配置覆盖

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/memory/types.ts` | 修改 | 新增 `memory_upsert`/`memory_delete` 的 tool schema |
| `src/memory/extractor.ts` | 重写 | LLM + tool call 提取逻辑 |
| `src/chat/chat-service.ts` | 修改 | `scheduleMemoryExtraction` 改为 async，传入 provider |
| `src/config/index.ts` | 修改 | `AppConfig` 新增 `memory` 段 |
| `src/__tests__/memory/extractor.test.ts` | 新建 | extractor 单元测试 |

---

### Task 1: 新增 Tool Schema 和 LLM 提取结果类型

**Files:**
- Modify: `src/memory/types.ts`

**Interfaces:**
- Produces: `MEMORY_UPSERT_TOOL_SCHEMA` (constant, exported), `MEMORY_DELETE_TOOL_SCHEMA` (constant, exported), `MemoryToolCall` (type, exported for testing)

- [ ] **Step 1: 在 types.ts 末尾追加 tool schema 和结果类型**

在 `src/memory/types.ts` 末尾追加：

```typescript
// MemoryToolCall —— LLM 通过 tool call 返回的记忆操作
export interface MemoryUpsertCall {
  id?: string; // 已有笔记 id（更新时填写）
  category: MemoryCategory;
  title: string;
  body: string;
  summary: string;
  reason: string;
}

export interface MemoryDeleteCall {
  id: string;
  reason: string;
}

// MEMORY_UPSERT_TOOL_SCHEMA —— memory_upsert 工具定义，传给 LLM
export const MEMORY_UPSERT_TOOL_SCHEMA = {
  name: "memory_upsert",
  description: `写入或更新一条有跨会话复用价值的记忆。

什么时候调用：
- 用户明确表达偏好或约束时（如"以后不要自动提交"、"每次开发完用中文回复"）
- 用户纠正了 AI 的错误理解
- 对话中出现了可复用的项目知识（架构决策、命名约定、关键依赖等）
- 对话中出现了有价值的参考资料

什么时候不调用：
- 对话内容是一次性的、只在当前会话有效
- 信息已在已有记忆索引中（此时应跳过，不调用任何工具）
- 内容琐碎、没有复用价值`,
  inputSchema: {
    type: "object" as const,
    properties: {
      id: {
        type: "string",
        description: "已有笔记的 id（更新时填写），新增笔记时留空不填",
      },
      category: {
        type: "string",
        enum: ["user_preference", "correction_feedback", "project_knowledge", "reference_material"],
        description: "记忆分类",
      },
      title: {
        type: "string",
        description: "笔记标题，简洁概括要点",
      },
      body: {
        type: "string",
        description: "笔记正文，包含足够上下文使记忆独立可读",
      },
      summary: {
        type: "string",
        description: "一行摘要（不超过 120 字符），用于索引展示",
      },
      reason: {
        type: "string",
        description: "简要说明为什么记录这条，便于调试",
      },
    },
    required: ["category", "title", "body", "summary", "reason"],
  },
};

// MEMORY_DELETE_TOOL_SCHEMA —— memory_delete 工具定义，传给 LLM
export const MEMORY_DELETE_TOOL_SCHEMA = {
  name: "memory_delete",
  description:
    "删除一条已过时或错误的记忆。仅当已有记忆与当前对话明显矛盾、或已被用户明确推翻时调用。",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: {
        type: "string",
        description: "要删除的记忆 id（来自已有记忆索引中的 noteId）",
      },
      reason: {
        type: "string",
        description: "删除原因",
      },
    },
    required: ["id", "reason"],
  },
};
```

- [ ] **Step 2: 运行测试确认类型编译通过**

```bash
pnpm test -- --run 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/memory/types.ts
git commit -m "feat: memory 新增 tool schema 和 LLM 提取结果类型

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 重写 extractFromTurn

**Files:**
- Modify: `src/memory/extractor.ts`

**Interfaces:**
- Consumes: `MemoryExtractionJob`, `MemoryNote`, `MemoryIndexEntry`, `MemoryUpsertCall`, `MemoryDeleteCall`, `MEMORY_UPSERT_TOOL_SCHEMA`, `MEMORY_DELETE_TOOL_SCHEMA` (from `types.js`)
- Consumes: `LLMProvider`, `ChatConfig`, `Message`, `Chunk` (from `provider/types.js`)
- Consumes: `upsertNote`, `deleteNote`, `renderIndexText` (from `store.js`)
- Produces: `extractFromTurn(job, messages, provider, config, signal): Promise<{ upserted: MemoryNote[]; deleted: string[] }>`

- [ ] **Step 1: 重写 extractor.ts**

用以下内容替换 `src/memory/extractor.ts`：

```typescript
import type { MemoryExtractionJob, MemoryNote, MemoryUpsertCall, MemoryDeleteCall } from "./types.js";
import { MEMORY_UPSERT_TOOL_SCHEMA, MEMORY_DELETE_TOOL_SCHEMA } from "./types.js";
import type { Message, ChatConfig, LLMProvider, Chunk } from "../provider/types.js";
import { upsertNote, deleteNote, renderIndexText } from "./store.js";

// 提取用 system prompt
const EXTRACTION_SYSTEM_PROMPT = `你是一个记忆提炼助手。分析本轮对话，提取可跨会话复用的知识。

## 记忆分类
- user_preference: 用户偏好（"以后不要..."、"每次都要..."、"记得..."）
- correction_feedback: 用户纠正 AI 的错误
- project_knowledge: 项目知识（架构决策、命名约定、依赖关系、文件组织等）
- reference_material: 有价值的参考资料（链接、文档引用等）

## 规则
- 只记录有跨会话复用价值的内容
- 一次性对话内容不记录
- 已有索引中已覆盖的内容不重复记录
- 如果发现已有记忆与当前事实矛盾，用 memory_delete 删除过时记忆
- 如果没有值得记录的内容，不调用任何工具`;

// 构建提取用消息列表
function buildExtractionMessages(
  job: MemoryExtractionJob,
  messages: Message[],
): Message[] {
  const turnMessages = messages.slice(job.turnRange.start, job.turnRange.end);
  const existingText = renderIndexText(job.existingMemoryIndex);

  const contextLines: string[] = [];
  if (existingText) {
    contextLines.push("## 已有记忆索引", existingText);
  }
  contextLines.push("## 本轮对话");

  const turnText = turnMessages
    .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`)
    .join("\n\n---\n\n");

  return [
    {
      role: "user" as const,
      content: contextLines.join("\n\n") + "\n\n" + turnText,
      timestamp: new Date().toISOString(),
    },
  ];
}

// 生成笔记 id
function generateNoteId(category: string): string {
  const prefix = category === "user_preference" ? "pref" : "know";
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 从 Chunk 流中收集 tool call
// 只处理 tool_use chunk（包含完整的 call.name + call.input）
async function collectToolCalls(
  stream: AsyncIterable<Chunk>,
): Promise<Array<{ name: string; input: Record<string, unknown> }>> {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  for await (const chunk of stream) {
    if (chunk.type === "tool_use") {
      calls.push({
        name: chunk.call.name,
        input: chunk.call.input as Record<string, unknown>,
      });
    }
  }
  return calls;
}

// extractFromTurn —— 从本轮对话提炼可复用知识
// 用 LLM 做语义判断，通过 tool call 输出 memory_upsert / memory_delete
export async function extractFromTurn(
  job: MemoryExtractionJob,
  messages: Message[],
  provider: LLMProvider,
  config: ChatConfig,
  signal: AbortSignal,
): Promise<{ upserted: MemoryNote[]; deleted: string[] }> {
  const upserted: MemoryNote[] = [];
  const deleted: string[] = [];

  // 构建提取消息
  const extractMessages = buildExtractionMessages(job, messages);

  // 调用 LLM
  const stream = provider.streamChat(
    extractMessages,
    config,
    signal,
    [MEMORY_UPSERT_TOOL_SCHEMA, MEMORY_DELETE_TOOL_SCHEMA] as Record<string, unknown>[],
    EXTRACTION_SYSTEM_PROMPT,
  );

  // 收集 tool call 结果
  const toolCalls = await collectToolCalls(stream);

  for (const call of toolCalls) {
    if (call.name === "memory_upsert") {
      const input = call.input as unknown as MemoryUpsertCall;
      // 校验必填字段
      if (!input.category || !input.title || !input.body || !input.summary) {
        continue;
      }

      const id = input.id || generateNoteId(input.category);
      const note: MemoryNote = {
        id,
        scope: "project",
        category: input.category,
        title: input.title,
        summary: input.summary,
        body: input.body,
        sourceSessionId: job.sessionId,
        updatedAt: new Date().toISOString(),
      };

      try {
        upsertNote(note, job.projectRoot);
        upserted.push(note);
      } catch (e) {
        console.warn("[MemoryExtractor] upsert 失败：", (e as Error).message);
      }
    } else if (call.name === "memory_delete") {
      const input = call.input as unknown as MemoryDeleteCall;
      if (!input.id) continue;

      try {
        deleteNote(input.id, "project", job.projectRoot);
        deleted.push(input.id);
      } catch (e) {
        console.warn("[MemoryExtractor] delete 失败：", (e as Error).message);
      }
    }
  }

  return { upserted, deleted };
}
```

- [ ] **Step 2: 运行类型检查确认编译通过**

```bash
pnpm test -- --run 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/memory/extractor.ts
git commit -m "feat: 用 LLM + tool call 替换关键词启发式记忆提取

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 更新 ChatService.scheduleMemoryExtraction

**Files:**
- Modify: `src/chat/chat-service.ts:587-611`

**Interfaces:**
- Consumes: `extractFromTurn` (new signature from extractor.js)
- Consumes: `provider`, `config` (from ChatService instance)
- Produces: `scheduleMemoryExtraction` (new async signature)

- [ ] **Step 1: 修改 scheduleMemoryExtraction 方法**

替换 `src/chat/chat-service.ts` 中的 `scheduleMemoryExtraction` 方法（第 587-611 行）：

```typescript
  // scheduleMemoryExtraction —— 自然结束后异步提炼记忆
  private scheduleMemoryExtraction(prevCount: number): void {
    const projectRoot = process.cwd();
    // 读取已有索引
    let existingIndex: MemoryIndexBundle;
    try {
      existingIndex = loadIndexes(projectRoot);
    } catch {
      existingIndex = { project: [], user: [] };
    }

    const job: MemoryExtractionJob = {
      sessionId: basename(this.historyPath, ".jsonl"),
      turnRange: { start: prevCount, end: this.messages.length },
      projectRoot,
      existingMemoryIndex: existingIndex,
      triggeredAt: new Date().toISOString(),
    };

    // 用独立的 AbortController，不跟主对话共享
    const signal = new AbortController().signal;

    // 异步提炼，不阻塞主路径
    extractFromTurn(
      job,
      this.messages,
      this.provider,
      this.config,
      signal,
    )
      .then(({ upserted, deleted }) => {
        if (upserted.length > 0) {
          console.log(`[MemoryExtractor] 提炼记忆 ${upserted.length} 条：${upserted.map((n) => n.title).join(", ")}`);
        }
        if (deleted.length > 0) {
          console.log(`[MemoryExtractor] 删除记忆 ${deleted.length} 条：${deleted.join(", ")}`);
        }
      })
      .catch((e) => {
        console.warn("[MemoryExtractor] 提炼失败：", (e as Error).message);
      });
  }
```

确保文件顶部的 import 已包含需要的类型：

检查 `import { extractFromTurn } from "../memory/extractor.js";` 已存在，以及 `import { loadIndexes } from "../memory/store.js";` 已存在，和 `import type { MemoryExtractionJob, MemoryIndexBundle } from "../memory/types.js";` 已存在。

- [ ] **Step 2: 运行测试确认编译通过**

```bash
pnpm test -- --run 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/chat/chat-service.ts
git commit -m "feat: scheduleMemoryExtraction 适配新的 LLM 提取接口

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 新增 memory 配置段

**Files:**
- Modify: `src/config/index.ts`

**Interfaces:**
- Consumes: 无新依赖
- Produces: `MemoryConfig` (interface), `AppConfig.memory` (新字段)

- [ ] **Step 1: 新增 MemoryConfig 接口和 AppConfig 字段**

在 `src/config/index.ts` 中的 `AppConfig` 接口定义前添加：

```typescript
// MemoryConfig —— memory 配置段
export interface MemoryConfig {
  model?: string;    // 记忆提取专用模型，不配则用主模型
  enabled?: boolean; // 是否启用自动记忆，默认 true
}
```

在 `AppConfig` 接口中添加 `memory` 字段：

```typescript
export interface AppConfig extends ChatConfig {
  agentLoop: AgentLoopYamlConfig;
  memory: MemoryConfig;
  mcp?: { servers: Record<string, Record<string, unknown>> };
  coordinator?: { enabled: boolean };
}
```

在 `loadAppConfig` 函数的返回对象中添加 memory 解析（插入在 agentLoop 解析之后）：

```typescript
  // 解析 memory 段
  const memoryRaw = (parsed.memory as Record<string, unknown>) ?? {};
  const memory: MemoryConfig = {};
  if (typeof memoryRaw.model === "string") {
    memory.model = memoryRaw.model;
  }
  if (typeof memoryRaw.enabled === "boolean") {
    memory.enabled = memoryRaw.enabled;
  }

  return {
    ...chatConfig,
    agentLoop: {
      maxRounds: typeof agentLoop.max_rounds === "number" ? agentLoop.max_rounds : undefined,
    },
    memory,
    mcp: mcpServers ? { servers: mcpServers } : undefined,
  };
```

- [ ] **Step 2: 运行现有 config 测试确认不破坏**

```bash
pnpm vitest run src/__tests__/config.test.ts 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add src/config/index.ts
git commit -m "feat: AppConfig 新增 memory 配置段

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 写 extractor 单元测试

**Files:**
- Create: `src/__tests__/memory/extractor.test.ts`

**Interfaces:**
- Consumes: `extractFromTurn` (from `../../memory/extractor.js`)
- Consumes: `MemoryExtractionJob`, `MemoryNote` (from `../../memory/types.js`)
- Consumes: `LLMProvider`, `ChatConfig`, `Message`, `Chunk` (from `../../provider/types.js`)

- [ ] **Step 1: 创建测试文件**

创建 `src/__tests__/memory/extractor.test.ts`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { extractFromTurn } from "../../memory/extractor.js";
import { loadIndexes, readIndex, listNotes } from "../../memory/store.js";
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
  return {
    name: "mock",
    streamChat: vi.fn().mockRejectedValue(new Error("network error")),
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
```

- [ ] **Step 2: 运行测试确认通过**

```bash
pnpm vitest run src/__tests__/memory/extractor.test.ts 2>&1
```

- [ ] **Step 3: 运行全部测试确认不破坏已有功能**

```bash
pnpm test -- --run 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/memory/extractor.test.ts
git commit -m "test: extractFromTurn LLM 提取单元测试

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 清理旧的无意义记忆

**Files:**
- 纯清理操作，不修改代码

- [ ] **Step 1: 删除旧的 know-*.md 记忆文件**

```bash
rm /Users/liuwei/Code/Codia/memory/know-*.md
rm /Users/liuwei/Code/Codia/memory/pref-*.md 2>/dev/null
```

- [ ] **Step 2: 重建索引**

因为索引里还引用那些已删除的文件，需要重建：

```bash
# 索引会在下次提取时自动重建，也可以直接删除索引文件让它自动重建
rm /Users/liuwei/Code/Codia/memory/MEMORY.md
```

- [ ] **Step 3: Commit**

```bash
git add memory/
git commit -m "chore: 清理旧关键词启发式产生的无意义记忆

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 验证清单

全部 task 完成后，用户应在终端中手动验证：

1. **偏好提取**：对 Codia 说"以后每次回复用中文"，检查 `memory/` 下是否生成 `pref-*.md`，内容是否正确
2. **无价值对话不产生记忆**：说一句"hello"，检查 `memory/` 下是否没有新增文件
3. **重复内容不重复记录**：再说一次"以后每次回复用中文"，检查是否不会新增第二条偏好笔记
4. **/memory 命令**：输入 `/memory`，确认能正常显示当前记忆状态
5. **配置覆盖**：在 `codia.yaml` 中加 `memory: { model: "haiku" }`，确认提取正常工作
