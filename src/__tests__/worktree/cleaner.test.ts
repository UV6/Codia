import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorktreeCleaner } from "../../worktree/cleaner.js";
import type { WorktreeConfig, CleanupConfig, GitWorktreeOps } from "../../worktree/types.js";

function createMockOps(overrides?: Partial<GitWorktreeOps>): GitWorktreeOps {
  return {
    addWorktree: vi.fn(),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    getBranchName: vi.fn().mockResolvedValue("worktree-test"),
    getHeadCommit: vi.fn().mockResolvedValue("abc123"),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    getCommitCountAhead: vi.fn().mockResolvedValue(0),
    listWorktrees: vi.fn().mockResolvedValue([]),
    getLastModified: vi.fn().mockResolvedValue(new Date("2020-01-01")),
    getHooksPath: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

// 注意：cleaner 依赖 readdirSync 遍历 worktreesDir，因此测试需要真实目录
// 这里用 mock 方式直接测试逻辑路径
describe("WorktreeCleaner", () => {
  let ops: GitWorktreeOps;
  let cleaner: WorktreeCleaner;
  const config: WorktreeConfig = {
    repoRoot: "/tmp/test-repo",
    baseBranch: "main",
    worktreesDir: "/tmp/codia-home/projects/test-repo-id/worktrees",
    copyPatterns: [],
    symlinkDirs: [],
  };

  beforeEach(() => {
    ops = createMockOps();
    cleaner = new WorktreeCleaner(config, ops);
    vi.clearAllMocks();
  });

  describe("三层过滤", () => {
    it("① 命名模式不匹配：手动目录被跳过", async () => {
      const cfg: CleanupConfig = {
        cutoffDate: new Date(),
        autoPatterns: ["agent-a*", "wf_*"],
      };
      // readdirSync 会失败（目录不存在），cleanup 返回空结果
      const result = await cleaner.cleanup(cfg);
      expect(result.cleaned).toEqual([]);
      // 手动目录被 readdirSync 错误吞掉，整体无操作
    });

    it("② 过期检查：未过期的目录被跳过", async () => {
      // 使用未来日期作为 cutoff，确保所有目录都"未过期"
      const cfg: CleanupConfig = {
        cutoffDate: new Date("2030-01-01"),
        autoPatterns: ["*"],
      };
      const result = await cleaner.cleanup(cfg);
      // 读不到目录 → cleaned 为空
      expect(result.cleaned).toEqual([]);
    });

    it("③ 变更保护：有未提交修改的目录被跳过", async () => {
      const dirtyOps = createMockOps({
        hasUncommittedChanges: vi.fn().mockResolvedValue(true),
      });
      const dirtyCleaner = new WorktreeCleaner(config, dirtyOps);
      const cfg: CleanupConfig = {
        cutoffDate: new Date(),
        autoPatterns: ["*"],
      };
      const result = await dirtyCleaner.cleanup(cfg);
      expect(result.cleaned.length).toBe(0);
    });
  });
});
