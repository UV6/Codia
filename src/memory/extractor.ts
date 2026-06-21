import type { MemoryExtractionJob, MemoryNote, MemoryUpsertCall, MemoryDeleteCall } from "./types.js";
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
- 如果发现已有记忆与当前事实矛盾，输出 action: "delete" 删除过时记忆
- 如果没有值得记录的内容，输出空数组 []

## 输出格式
在回复末尾输出一个 JSON 代码块，格式如下：

\`\`\`json
[
  {"action": "upsert", "category": "user_preference", "title": "简短标题", "body": "完整正文", "summary": "一行摘要", "reason": "记录原因"},
  {"action": "delete", "id": "已有笔记id", "reason": "删除原因"}
]
\`\`\`

- action: "upsert"（新增/更新）或 "delete"（删除）
- upsert 必填: category, title, body, summary, reason
- delete 必填: id（来自已有记忆索引中的 noteId）, reason
- 没有值得记录的内容时输出空数组 []`;

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

// 从流中收集完整文本
async function collectText(stream: AsyncIterable<Chunk>): Promise<string> {
  let text = "";
  for await (const chunk of stream) {
    if (chunk.type === "text") {
      text += chunk.content;
    }
  }
  return text;
}

// 从文本中提取 JSON 代码块
function extractJsonFromText(text: string): unknown | null {
  // 匹配 ```json ... ``` 代码块
  const jsonBlock = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlock) {
    try {
      return JSON.parse(jsonBlock[1].trim());
    } catch {
      // JSON 解析失败，继续尝试其他方式
    }
  }

  // 匹配 ``` ... ``` 代码块（无语言标记）
  const codeBlock = text.match(/```\s*([\s\S]*?)```/);
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1].trim());
    } catch {
      // 解析失败
    }
  }

  return null;
}

// extractFromTurn —— 从本轮对话提炼可复用知识
// 用 LLM 做语义判断，输出 JSON 文本（不依赖 tool call，兼容更多 API）
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

  // 调用 LLM（不传 tools，改用文本 JSON 输出）
  const stream = provider.streamChat(
    extractMessages,
    config,
    signal,
    undefined,
    EXTRACTION_SYSTEM_PROMPT,
  );

  // 收集完整文本
  const fullText = await collectText(stream);

  // 提取 JSON
  const parsed = extractJsonFromText(fullText);
  if (!parsed || !Array.isArray(parsed)) {
    // LLM 没有输出有效的 JSON 操作数组 — 没有值得记录的内容
    return { upserted, deleted };
  }

  for (const item of parsed as Array<Record<string, unknown>>) {
    const action = item.action as string;

    if (action === "upsert") {
      const input = item as unknown as MemoryUpsertCall;
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
    } else if (action === "delete") {
      const input = item as unknown as MemoryDeleteCall;
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
