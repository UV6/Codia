import { describe, it, expect, vi } from "vitest";
import type { GitWorktreeOps } from "../../worktree/types.js";
import { migrateLegacyWorktrees } from "../../worktree/migrate.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function createMockOps(paths: string[]): GitWorktreeOps {
  return {
    addWorktree: vi.fn(),
    moveWorktree: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn(),
    deleteBranch: vi.fn(),
    getBranchName: vi.fn(),
    getHeadCommit: vi.fn(),
    hasUncommittedChanges: vi.fn(),
    getCommitCountAhead: vi.fn(),
    listWorktrees: vi.fn().mockResolvedValue(paths),
    getLastModified: vi.fn(),
    getHooksPath: vi.fn(),
  } as unknown as GitWorktreeOps;
}

describe("migrateLegacyWorktrees", () => {
  it("只迁移旧根目录下已注册的 worktree", async () => {
    const root = join(tmpdir(), `codia-worktree-migrate-${randomUUID().slice(0, 8)}`);
    const legacyRoot = join(root, "repo", ".codia", "worktrees");
    const targetRoot = join(root, "home", ".codia", "projects", "p1", "worktrees");
    const ops = createMockOps([
      join(legacyRoot, "a"),
      join(legacyRoot, "sub", "b"),
      join(root, "other", "path"),
    ]);

    const result = await migrateLegacyWorktrees(
      legacyRoot,
      targetRoot,
      ops,
    );

    expect(result.moved).toEqual([
      {
        from: join(legacyRoot, "a"),
        to: join(targetRoot, "a"),
      },
      {
        from: join(legacyRoot, "sub", "b"),
        to: join(targetRoot, "sub", "b"),
      },
    ]);
    expect((ops.moveWorktree as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
