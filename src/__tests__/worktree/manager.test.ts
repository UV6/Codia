import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorktreeManager, WorktreeNotFoundError } from "../../worktree/manager.js";
import { WorktreePath } from "../../worktree/path-validator.js";
import type { WorktreeConfig, GitWorktreeOps } from "../../worktree/types.js";

function createMockOps(overrides?: Partial<GitWorktreeOps>): GitWorktreeOps {
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
    ...overrides,
  };
}

const config: WorktreeConfig = {
  repoRoot: "/tmp/test-repo",
  baseBranch: "main",
  worktreesDir: "/tmp/test-repo/.codia/worktrees",
  copyPatterns: [],
  symlinkDirs: [],
};

describe("WorktreeManager", () => {
  let ops: GitWorktreeOps;
  let manager: WorktreeManager;

  beforeEach(() => {
    ops = createMockOps();
    // 默认 listWorktrees 返回已创建的 worktree
    (ops.listWorktrees as ReturnType<typeof vi.fn>).mockResolvedValue([
      "/tmp/test-repo/.codia/worktrees/test",
    ]);
    manager = new WorktreeManager(config, ops);
    vi.clearAllMocks();
  });

  describe("enter", () => {
    it("返回正确的 cwd 绝对路径", async () => {
      const result = await manager.enter("test");
      expect(result.cwd).toBe("/tmp/test-repo/.codia/worktrees/test");
      expect(result.info.name).toBe("test");
    });

    it("返回的 cwd 是绝对路径", async () => {
      const result = await manager.enter("test");
      expect(result.cwd.startsWith("/")).toBe(true);
    });

    it("非法名称抛出 ValidationError", async () => {
      await expect(manager.enter("../escape")).rejects.toThrow();
    });
  });

  describe("exit", () => {
    it("无变更时正常删除 worktree", async () => {
      const result = await manager.exit("test");
      expect(result.action).toBe("removed");
      expect(ops.removeWorktree).toHaveBeenCalled();
    });

    it("有未提交修改时拒绝删除（无 force）", async () => {
      const dirtyOps = createMockOps({
        hasUncommittedChanges: vi.fn().mockResolvedValue(true),
        listWorktrees: vi.fn().mockResolvedValue(["/tmp/test-repo/.codia/worktrees/test"]),
      });
      const dirtyManager = new WorktreeManager(config, dirtyOps);

      const result = await dirtyManager.exit("test");
      expect(result.action).toBe("kept");
      expect(result.warning).toBeTruthy();
      expect(dirtyOps.removeWorktree).not.toHaveBeenCalled();
    });

    it("有变更 + force 时正常删除", async () => {
      const dirtyOps = createMockOps({
        hasUncommittedChanges: vi.fn().mockResolvedValue(true),
        listWorktrees: vi.fn().mockResolvedValue(["/tmp/test-repo/.codia/worktrees/test"]),
      });
      const dirtyManager = new WorktreeManager(config, dirtyOps);

      const result = await dirtyManager.exit("test", { force: true });
      expect(result.action).toBe("removed");
      expect(dirtyOps.removeWorktree).toHaveBeenCalled();
    });

    it("keep=true 保留目录", async () => {
      const result = await manager.exit("test", { keep: true });
      expect(result.action).toBe("kept");
      expect(ops.removeWorktree).not.toHaveBeenCalled();
    });

    it("不存在的 worktree 抛出 WorktreeNotFoundError", async () => {
      const emptyOps = createMockOps({
        listWorktrees: vi.fn().mockResolvedValue([]),
      });
      const emptyManager = new WorktreeManager(config, emptyOps);

      await expect(emptyManager.exit("nonexistent")).rejects.toThrow(WorktreeNotFoundError);
    });
  });

  describe("delete", () => {
    it("强制删除 worktree", async () => {
      await expect(manager.delete("test")).resolves.toBeUndefined();
      expect(ops.removeWorktree).toHaveBeenCalledWith(
        "/tmp/test-repo/.codia/worktrees/test",
        true,
      );
    });

    it("不存在的 worktree 抛出 WorktreeNotFoundError", async () => {
      const emptyOps = createMockOps({
        listWorktrees: vi.fn().mockResolvedValue([]),
      });
      const emptyManager = new WorktreeManager(config, emptyOps);

      await expect(emptyManager.delete("nonexistent")).rejects.toThrow(WorktreeNotFoundError);
    });
  });

  describe("getCleaner", () => {
    it("返回 WorktreeCleaner 实例", () => {
      const cleaner = manager.getCleaner();
      expect(cleaner).toBeDefined();
      expect(typeof cleaner.cleanup).toBe("function");
    });
  });
});
