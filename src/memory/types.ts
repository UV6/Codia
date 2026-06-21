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
