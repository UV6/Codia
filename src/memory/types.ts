// MemoryScope —— 记忆作用域
export type MemoryScope = "user" | "project";

// MemoryCategory —— 自动记忆分类
export type MemoryCategory =
  | "user_preference"
  | "correction_feedback"
  | "project_knowledge"
  | "reference_material";

// MemoryNote —— 单条自动记忆笔记
export interface MemoryNote {
  id: string;
  scope: MemoryScope;
  category: MemoryCategory;
  title: string;
  summary: string;
  body: string;
  sourceSessionId: string;
  updatedAt: string;
  tags?: string[];
}

// MemoryIndexEntry —— 注入启动上下文的记忆索引条目
export interface MemoryIndexEntry {
  noteId: string;
  category: MemoryCategory;
  summary: string;
  updatedAt: string;
  path: string;
}

// MemoryIndexBundle —— 当前可见的双作用域索引摘要
export interface MemoryIndexBundle {
  project: MemoryIndexEntry[];
  user: MemoryIndexEntry[];
}

// MemoryTurnRange —— 本轮消息范围
export interface MemoryTurnRange {
  start: number;
  end: number;
}

// MemoryExtractionJob —— 自然结束后调度的记忆提炼任务
export interface MemoryExtractionJob {
  sessionId: string;
  turnRange: MemoryTurnRange;
  projectRoot: string;
  existingMemoryIndex: MemoryIndexBundle;
  triggeredAt: string;
}
