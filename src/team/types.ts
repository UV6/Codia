// 团队系统核心类型定义

// TeamConfig —— 小组配置，持久化为 group.json
export interface TeamConfig {
  name: string; // 小组名称
  lead: string; // Lead 成员名称
  members: MemberInfo[]; // 成员花名册
  createdAt: string; // ISO 8601
  updatedAt: string;
}

// MemberInfo —— 成员元数据
export interface MemberInfo {
  name: string; // 成员名称（唯一标识）
  role: "lead" | "worker"; // 角色
  workDir: string; // git worktree 路径或共享 cwd
  backend: "tmux" | "in-process"; // 运行时后端
  requiresApproval: boolean; // 是否需要审批
  status: "active" | "idle" | "stopped"; // 当前状态
  contextDir: string; // 上下文持久化目录
  sessionId: string | null; // tmux session ID 或进程 ID（活跃时）
}

// SharedTask —— 共享任务条目
export interface SharedTask {
  id: string; // UUID
  title: string; // 简短标题
  description: string; // 任务描述
  status: "pending" | "in_progress" | "completed" | "failed";
  assignee: string | null; // 负责成员名称（null = 未分配）
  dependencies: string[]; // 依赖任务 ID 列表
  createdAt: string; // ISO 8601
  updatedAt: string;
}

// TeamMessage —— 团队消息
export interface TeamMessage {
  id: string; // UUID
  from: string; // 发件人名称
  to: string | "*"; // 收件人名称，"*" 表示广播
  type:
    | "text"
    | "broadcast"
    | "approval_request"
    | "approval_response"
    | "task_assignment"
    | "member_idle";
  body: string; // 正文（普通文本或 JSON 字符串）
  timestamp: string; // ISO 8601，系统自动补
  read: boolean; // 默认 false
  summary: string; // 一行摘要
}

// ApprovalResponse —— 审批响应 JSON 结构
export interface ApprovalResponse {
  type: "approval_response";
  action: "approved" | "rejected";
  planId: string;
  reason: string;
}

// SpawnResult —— 成员派生结果
export interface SpawnResult {
  memberName: string;
  backend: "tmux" | "in-process";
  degraded: boolean; // 是否发生了降级
  degradeReason?: string; // 降级原因（如有）
  sessionId: string | null; // tmux session ID
  workDir: string;
}

// MergeResult —— git 合并结果
export interface MergeResult {
  memberName: string;
  branch: string;
  status: "merged" | "conflict" | "rolled_back";
  details: string; // 成功摘要或冲突/回滚原因
}
