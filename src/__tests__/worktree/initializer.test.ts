import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync, symlinkSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { WorktreeInitializer } from "../../worktree/initializer.js";
import { RealGitWorktreeOps } from "../../worktree/git-ops.js";
import type { WorktreeConfig, GitWorktreeOps } from "../../worktree/types.js";

function setupTempDirs(): { repoRoot: string; targetPath: string; cleanup: () => void } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "codia-test-init-")));
  const repoRoot = join(base, "repo");
  const targetPath = join(base, "worktree");
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(targetPath, { recursive: true });

  // 初始化 git 仓库
  execFileSync("git", ["init"], { cwd: repoRoot });
  execFileSync("git", ["config", "--local", "user.name", "test"], { cwd: repoRoot });
  execFileSync("git", ["config", "--local", "user.email", "test@test"], { cwd: repoRoot });
  writeFileSync(join(repoRoot, "README.md"), "test");
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repoRoot });

  // 初始化 target 为 git worktree
  execFileSync("git", ["worktree", "add", targetPath], { cwd: repoRoot });

  return {
    repoRoot,
    targetPath,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

// MockGitWorktreeOps —— 可控制的 mock，用于测试 hooksPath 行为
class MockGitWorktreeOps implements GitWorktreeOps {
  hooksPath: string | null = null;

  async addWorktree(): Promise<void> {}
  async removeWorktree(): Promise<void> {}
  async deleteBranch(): Promise<void> {}
  async getBranchName(): Promise<string> { return "test"; }
  async getHeadCommit(): Promise<string> { return "abc123"; }
  async hasUncommittedChanges(): Promise<boolean> { return false; }
  async getCommitCountAhead(): Promise<number> { return 0; }
  async listWorktrees(): Promise<string[]> { return []; }
  async getLastModified(): Promise<Date> { return new Date(); }
  async getHooksPath(): Promise<string | null> { return this.hooksPath; }
}

describe("WorktreeInitializer", () => {
  let repoRoot: string;
  let targetPath: string;
  let cleanup: () => void;

  beforeAll(() => {
    const temp = setupTempDirs();
    repoRoot = temp.repoRoot;
    targetPath = temp.targetPath;
    cleanup = temp.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  describe("复制配置文件", () => {
    it("将主目录的 CLAUDE.md 复制到 worktree", async () => {
      writeFileSync(join(repoRoot, "CLAUDE.md"), "# Test Config");
      const ops = new RealGitWorktreeOps(repoRoot);
      const config: WorktreeConfig = {
        repoRoot,
        baseBranch: "main",
        worktreesDir: join(tmpdir(), "codia-home", "projects", "initializer-test", "worktrees"),
        copyPatterns: ["CLAUDE.md"],
        symlinkDirs: [],
      };
      const initializer = new WorktreeInitializer(config, ops);
      await initializer.initialize(targetPath, repoRoot);

      const dest = join(targetPath, "CLAUDE.md");
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, "utf-8")).toBe("# Test Config");
    });

    it("将 .claude/ 下的配置复制到 worktree", async () => {
      mkdirSync(join(repoRoot, ".claude"), { recursive: true });
      writeFileSync(join(repoRoot, ".claude", "settings.json"), '{"key":"value"}');

      const ops = new RealGitWorktreeOps(repoRoot);
      const config: WorktreeConfig = {
        repoRoot,
        baseBranch: "main",
        worktreesDir: join(tmpdir(), "codia-home", "projects", "initializer-test", "worktrees"),
        copyPatterns: [".claude/**"],
        symlinkDirs: [],
      };
      const initializer = new WorktreeInitializer(config, ops);
      await initializer.initialize(targetPath, repoRoot);

      const dest = join(targetPath, ".claude", "settings.json");
      expect(existsSync(dest)).toBe(true);
    });
  });

  describe("软链接依赖", () => {
    it("对 node_modules 创建软链接", async () => {
      mkdirSync(join(repoRoot, "node_modules"), { recursive: true });
      writeFileSync(join(repoRoot, "node_modules", "test-pkg.json"), "pkg");

      const ops = new RealGitWorktreeOps(repoRoot);
      const config: WorktreeConfig = {
        repoRoot,
        baseBranch: "main",
        worktreesDir: join(tmpdir(), "codia-home", "projects", "initializer-test", "worktrees"),
        copyPatterns: [],
        symlinkDirs: ["node_modules"],
      };
      const initializer = new WorktreeInitializer(config, ops);
      await initializer.initialize(targetPath, repoRoot);

      const dest = join(targetPath, "node_modules");
      expect(existsSync(dest)).toBe(true);
    });
  });

  describe("hooks 复制", () => {
    it("hooksPath 为 null 时回退到 gitdir/hooks", async () => {
      const ops = new MockGitWorktreeOps();
      ops.hooksPath = null;

      const config: WorktreeConfig = {
        repoRoot,
        baseBranch: "main",
        worktreesDir: "",
        copyPatterns: [],
        symlinkDirs: [],
      };
      const initializer = new WorktreeInitializer(config, ops);
      // 不应抛异常
      await expect(
        initializer.initialize(targetPath, repoRoot),
      ).resolves.toBeUndefined();
    });

    it("hooksPath 指向不存在目录时不抛异常", async () => {
      const ops = new MockGitWorktreeOps();
      ops.hooksPath = "/nonexistent/hooks";

      const config: WorktreeConfig = {
        repoRoot,
        baseBranch: "main",
        worktreesDir: "",
        copyPatterns: [],
        symlinkDirs: [],
      };
      const initializer = new WorktreeInitializer(config, ops);
      await expect(
        initializer.initialize(targetPath, repoRoot),
      ).resolves.toBeUndefined();
    });
  });
});
