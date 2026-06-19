import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { WorktreeCreator } from "../../worktree/creator.js";
import { WorktreeInitializer } from "../../worktree/initializer.js";
import { WorktreePath } from "../../worktree/path-validator.js";
import { RealGitWorktreeOps } from "../../worktree/git-ops.js";
import type { WorktreeConfig, GitWorktreeOps } from "../../worktree/types.js";

function createMockOps(): GitWorktreeOps {
  return {
    addWorktree: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    getBranchName: vi.fn().mockResolvedValue("worktree-test"),
    getHeadCommit: vi.fn().mockResolvedValue("abc123def456"),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    getCommitCountAhead: vi.fn().mockResolvedValue(0),
    listWorktrees: vi.fn().mockResolvedValue([]),
    getLastModified: vi.fn().mockResolvedValue(new Date()),
    getHooksPath: vi.fn().mockResolvedValue(null),
  };
}

function createMockInitializer(): WorktreeInitializer {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorktreeInitializer;
}

const config: WorktreeConfig = {
  repoRoot: "/tmp/test-repo",
  baseBranch: "main",
  worktreesDir: "/tmp/test-repo/.codia/worktrees",
  copyPatterns: [],
  symlinkDirs: [],
};

describe("WorktreeCreator", () => {
  let ops: GitWorktreeOps;
  let initializer: WorktreeInitializer;
  let creator: WorktreeCreator;

  beforeEach(() => {
    ops = createMockOps();
    initializer = createMockInitializer();
    creator = new WorktreeCreator(config, ops, initializer);
    vi.clearAllMocks();
  });

  it("正常创建流程调用 addWorktree 和 initialize", async () => {
    const wp = WorktreePath.validate("test", config);
    const info = await creator.create(wp);

    expect(ops.addWorktree).toHaveBeenCalledWith(
      wp.fsPath,
      wp.branchName,
      config.baseBranch,
    );
    expect(initializer.initialize).toHaveBeenCalledWith(wp.fsPath, config.repoRoot);
    expect(info.name).toBe("test");
    expect(info.path).toBe(wp.fsPath);
    expect(info.branch).toBe(wp.branchName);
  });

  it("幂等：连续两次 create 同一 name，addWorktree 只调用一次", async () => {
    const wp = WorktreePath.validate("test", config);
    // 预先创建目录（模拟已存在）
    mkdirSync(wp.fsPath, { recursive: true });
    try {
      const ops2 = createMockOps();
      (ops2.listWorktrees as ReturnType<typeof vi.fn>).mockResolvedValue([wp.fsPath]);
      const creator2 = new WorktreeCreator(config, ops2, initializer);

      await creator2.create(wp);

      expect(ops2.addWorktree).not.toHaveBeenCalled();
    } finally {
      rmSync(wp.fsPath, { recursive: true, force: true });
      rmSync(config.worktreesDir, { recursive: true, force: true });
    }
  });

  it("初始化失败时执行回滚", async () => {
    const failingInit = {
      initialize: vi.fn().mockRejectedValue(new Error("init failed")),
    } as unknown as WorktreeInitializer;

    const failingCreator = new WorktreeCreator(config, ops, failingInit);
    const wp = WorktreePath.validate("test", config);

    await expect(failingCreator.create(wp)).rejects.toThrow("已回滚");
    expect(ops.removeWorktree).toHaveBeenCalledWith(wp.fsPath, true);
  });

  it("返回的 WorktreeInfo 包含正确的 headCommit", async () => {
    const ops3 = createMockOps();
    (ops3.getHeadCommit as ReturnType<typeof vi.fn>).mockResolvedValue("deadbeef1234");
    const creator3 = new WorktreeCreator(config, ops3, initializer);
    const wp = WorktreePath.validate("test", config);

    const info = await creator3.create(wp);
    expect(info.headCommit).toBe("deadbeef1234");
  });

  it("hasUncommittedChanges 失败时 isClean 默认为 true", async () => {
    const ops4 = createMockOps();
    (ops4.hasUncommittedChanges as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
    const creator4 = new WorktreeCreator(config, ops4, initializer);
    const wp = WorktreePath.validate("test", config);

    const info = await creator4.create(wp);
    expect(info.isClean).toBe(true);
  });
});
