// WorktreeConfig —— 工作目录创建所需配置
export interface WorktreeConfig {
  repoRoot: string; // git 仓库根路径
  baseBranch: string; // worktree 基于的分支（如 "main"）
  worktreesDir: string; // worktree 存放目录，默认 "<repoRoot>/.codia/worktrees"
  copyPatterns: string[]; // 需复制的配置 glob，如 [".claude/**", "CLAUDE.md"]
  symlinkDirs: string[]; // 需软链的目录，如 ["node_modules"]
}

// WorktreeInfo —— 单个 worktree 的元数据快照
export interface WorktreeInfo {
  name: string; // 目录名（相对于 worktreesDir）
  path: string; // 完整文件系统路径
  branch: string; // git 分支名
  headCommit: string; // 创建时的 HEAD commit sha
  createdAt: Date;
  lastActivityAt: Date;
  isClean: boolean; // 无未提交修改（git status --porcelain 为空）
  commitCountAhead: number; // 本地比 headCommit 多的 commit 数
}

// CleanupConfig —— 清理配置
export interface CleanupConfig {
  cutoffDate: Date; // 在此日期之前最后活动的工作目录视为过期
  autoPatterns: string[]; // 可自动清理的命名模式，如 ["agent-a*", "wf_*"]
}

// CleanupResult —— 清理操作结果
export interface CleanupResult {
  cleaned: string[]; // 已清理的目录名
  skipped: { name: string; reason: string }[]; // 跳过的目录及原因
}

// ExitResult —— 退出操作结果
export interface ExitResult {
  action: "kept" | "removed";
  path: string;
  info: WorktreeInfo;
  warning?: string; // 如果有变更被保护，说明原因
}

// GitWorktreeOps —— Git worktree 操作的接口抽象，便于测试 mock
export interface GitWorktreeOps {
  addWorktree(path: string, branch: string, baseBranch: string): Promise<void>;
  removeWorktree(path: string, force: boolean): Promise<void>;
  deleteBranch(branch: string): Promise<void>;
  getBranchName(path: string): Promise<string>;
  getHeadCommit(path: string): Promise<string>;
  hasUncommittedChanges(path: string): Promise<boolean>;
  getCommitCountAhead(path: string, baseCommit: string): Promise<number>;
  listWorktrees(): Promise<string[]>; // 返回所有 worktree 路径
  getLastModified(path: string): Promise<Date>;
  getHooksPath(repoRoot: string): Promise<string | null>; // git config core.hooksPath
}

// ValidationErrorCode —— 路径校验错误码
export type ValidationErrorCode =
  | "empty_segment"
  | "too_long"
  | "invalid_chars"
  | "absolute_path"
  | "path_traversal";

// ValidationError —— 路径名校验失败时抛出
export class ValidationError extends Error {
  code: ValidationErrorCode;
  field: string;

  constructor(code: ValidationErrorCode, message: string) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.field = "name";
  }
}
