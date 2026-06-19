import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { RealGitWorktreeOps } from "../../worktree/git-ops.js";

// 设置临时 git 仓库
function setupTempRepo(): { repoRoot: string; cleanup: () => void } {
  const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "codia-test-repo-")));
  execFileSync("git", ["init"], { cwd: repoRoot });
  execFileSync("git", ["config", "--local", "user.name", "test"], { cwd: repoRoot });
  execFileSync("git", ["config", "--local", "user.email", "test@test"], { cwd: repoRoot });
  // 将默认分支重命名为 main（兼容不同 git 版本的默认分支名）
  const branchName = execFileSync("git", ["branch", "--show-current"], {
    cwd: repoRoot, encoding: "utf-8",
  }).trim();
  if (branchName !== "main") {
    execFileSync("git", ["branch", "-m", "main"], { cwd: repoRoot });
  }
  // 初始 commit，否则无法创建 worktree
  writeFileSync(join(repoRoot, "README.md"), "test");
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repoRoot });
  return {
    repoRoot,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}

describe("RealGitWorktreeOps", () => {
  let repoRoot: string;
  let cleanup: () => void;
  let ops: RealGitWorktreeOps;

  beforeAll(() => {
    const temp = setupTempRepo();
    repoRoot = temp.repoRoot;
    cleanup = temp.cleanup;
    ops = new RealGitWorktreeOps(repoRoot);
  });

  afterAll(() => {
    cleanup();
  });

  describe("addWorktree + listWorktrees", () => {
    it("创建 worktree 后 listWorktrees 包含该路径", async () => {
      const path = join(repoRoot, ".codia", "worktrees", "test-agent");
      mkdirSync(join(repoRoot, ".codia", "worktrees"), { recursive: true });

      await ops.addWorktree(path, "worktree-test-agent", "main");

      const trees = await ops.listWorktrees();
      expect(trees).toContain(path);
    });
  });

  describe("getBranchName", () => {
    it("返回正确分支名", async () => {
      const path = join(repoRoot, ".codia", "worktrees", "test-agent");
      const branch = await ops.getBranchName(path);
      expect(branch).toBe("worktree-test-agent");
    });
  });

  describe("getHeadCommit", () => {
    it("返回非空的 commit sha", async () => {
      const path = join(repoRoot, ".codia", "worktrees", "test-agent");
      const sha = await ops.getHeadCommit(path);
      expect(sha).toBeTruthy();
      expect(sha.length).toBe(40);
    });
  });

  describe("hasUncommittedChanges", () => {
    it("无未提交文件时返回 false", async () => {
      const path = join(repoRoot, ".codia", "worktrees", "test-agent");
      const dirty = await ops.hasUncommittedChanges(path);
      expect(dirty).toBe(false);
    });

    it("有未提交文件时返回 true", async () => {
      const path = join(repoRoot, ".codia", "worktrees", "test-agent");
      writeFileSync(join(path, "new-file.txt"), "hello");
      const dirty = await ops.hasUncommittedChanges(path);
      expect(dirty).toBe(true);
      // cleanup the untracked file
      rmSync(join(path, "new-file.txt"));
    });
  });

  describe("getCommitCountAhead", () => {
    it("无新 commit 时返回 0", async () => {
      const path = join(repoRoot, ".codia", "worktrees", "test-agent");
      const headCommit = await ops.getHeadCommit(path);
      const count = await ops.getCommitCountAhead(path, headCommit);
      expect(count).toBe(0);
    });

    it("有新 commit 时返回 > 0", async () => {
      const path = join(repoRoot, ".codia", "worktrees", "test-agent");
      const headCommit = await ops.getHeadCommit(path);

      // 创建一个新 commit
      writeFileSync(join(path, "commit-test.txt"), "new commit");
      execFileSync("git", ["add", "commit-test.txt"], { cwd: path });
      execFileSync("git", ["commit", "-m", "test commit"], { cwd: path });

      const count = await ops.getCommitCountAhead(path, headCommit);
      expect(count).toBe(1);
    });
  });

  describe("removeWorktree + deleteBranch", () => {
    it("删除 worktree 后 listWorktrees 不含该路径", async () => {
      const path = join(repoRoot, ".codia", "worktrees", "test-agent-remove");
      mkdirSync(join(repoRoot, ".codia", "worktrees"), { recursive: true });
      await ops.addWorktree(path, "worktree-test-agent-remove", "main");

      await ops.removeWorktree(path, true);
      await ops.deleteBranch("worktree-test-agent-remove");

      const trees = await ops.listWorktrees();
      expect(trees).not.toContain(path);
    });
  });

  describe("getHooksPath", () => {
    it("返回 hooksPath 或 null", async () => {
      const result = await ops.getHooksPath(repoRoot);
      // 可以是 null 或 string
      expect(result === null || typeof result === "string").toBe(true);
    });
  });

  describe("getLastModified", () => {
    it("返回有效的 Date 对象", async () => {
      const path = join(repoRoot, ".codia", "worktrees", "test-agent");
      const date = await ops.getLastModified(path);
      expect(date).toBeInstanceOf(Date);
    });
  });
});
