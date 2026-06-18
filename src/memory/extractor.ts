import type { MemoryExtractionJob, MemoryNote, MemoryIndexEntry } from "./types.js";
import type { Message } from "../provider/types.js";
import { upsertNote, readIndex } from "./store.js";

// extractFromTurn —— 从本轮对话提炼可复用知识
// 当前阶段提供一个最小可用闭环：
//   1. 扫描本轮对话
//   2. 生成候选事实
//   3. 与已有索引对比做去重决策
//   4. 执行 upsert 并落盘
export async function extractFromTurn(
  job: MemoryExtractionJob,
  messages: Message[],
): Promise<{ upserted: MemoryNote[]; skipped: string[] }> {
  const upserted: MemoryNote[] = [];
  const skipped: string[] = [];

  // 获取本轮消息
  const turnMessages = messages.slice(job.turnRange.start, job.turnRange.end);
  const userMessages = turnMessages.filter((m) => m.role === "user");
  const assistantMessages = turnMessages.filter((m) => m.role === "assistant");

  // 扫描用户消息中的偏好指示
  const preferenceCandidates = extractPreferenceCandidates(userMessages, job);
  for (const candidate of preferenceCandidates) {
    const existing = findSimilarEntry(candidate, job.existingMemoryIndex.project);
    if (existing) {
      // 更新已有笔记
      candidate.id = existing.noteId;
      candidate.updatedAt = new Date().toISOString();
      upsertNote(candidate, job.projectRoot);
      upserted.push(candidate);
    } else {
      // 新增
      candidate.id = `pref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      candidate.updatedAt = new Date().toISOString();
      upsertNote(candidate, job.projectRoot);
      upserted.push(candidate);
    }
  }

  // 扫描项目知识（来自 assistant 的回答中可能包含的可复用信息）
  const knowledgeCandidates = extractKnowledgeCandidates(assistantMessages, job);
  for (const candidate of knowledgeCandidates) {
    const existing = findSimilarEntry(
      candidate,
      [...job.existingMemoryIndex.project, ...job.existingMemoryIndex.user],
    );
    if (existing) {
      skipped.push(candidate.summary);
      continue; // 已存在 → 跳过
    }
    candidate.id = `know-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    candidate.updatedAt = new Date().toISOString();
    upsertNote(candidate, job.projectRoot);
    upserted.push(candidate);
  }

  return { upserted, skipped };
}

function extractPreferenceCandidates(
  userMessages: Message[],
  job: MemoryExtractionJob,
): MemoryNote[] {
  const notes: MemoryNote[] = [];
  // 简单的关键词启发：用户消息中包含"以后"、"应该"、"不要"等指示性词汇
  const preferencePatterns = [
    /\b(?:以后|之后|每次|总是|应该|应当|不要|别|禁止|记得|记着|记住)\b/,
    /\b(?:always|never|should|must|remember|don'?t|prefer)\b/i,
  ];

  for (const msg of userMessages) {
    const content = msg.content;
    if (preferencePatterns.some((p) => p.test(content))) {
      notes.push({
        id: "",
        scope: "project",
        category: "user_preference",
        title: content.slice(0, 60),
        summary: content.slice(0, 120),
        body: content,
        sourceSessionId: job.sessionId,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return notes;
}

function extractKnowledgeCandidates(
  assistantMessages: Message[],
  job: MemoryExtractionJob,
): MemoryNote[] {
  const notes: MemoryNote[] = [];
  // 从 assistant 回复中提取可能包含项目知识的较长语句
  for (const msg of assistantMessages) {
    const content = msg.content;
    if (content.length > 200) {
      // 提取关键段落作为候选
      const sentences = content.split(/[。\n]/).filter((s) => s.trim().length > 30);
      for (const s of sentences.slice(0, 3)) {
        notes.push({
          id: "",
          scope: "project",
          category: "project_knowledge",
          title: s.trim().slice(0, 60),
          summary: s.trim().slice(0, 120),
          body: s.trim(),
          sourceSessionId: job.sessionId,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }
  return notes;
}

// findSimilarEntry —— 检查候选笔记是否与已有索引条目语义相似
// 使用简单的子串匹配；后续可由 LLM 做更好判断
function findSimilarEntry(
  candidate: MemoryNote,
  entries: MemoryIndexEntry[],
): MemoryIndexEntry | null {
  const summary = candidate.summary.slice(0, 50);
  for (const e of entries) {
    if (e.summary.includes(summary) || summary.includes(e.summary)) {
      return e;
    }
  }
  return null;
}
