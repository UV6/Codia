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
