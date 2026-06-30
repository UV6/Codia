import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import type { GitWorktreeOps } from "./types.js";

const execFileAsync = promisify(execFile);

// execGit —— 在 repoRoot 下执行 git 命令，返回 stdout
async function execGit(
  repoRoot: string,
  args: string[],
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    encoding: "utf-8",
    timeout: 30_000,
  });
  return stdout.trim();
}

// execGitInWorktree —— 在 worktree 目录下执行 git 命令
async function execGitInWorktree(
  worktreePath: string,
  args: string[],
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: worktreePath,
    encoding: "utf-8",
    timeout: 30_000,
  });
  return stdout.trim();
}

// RealGitWorktreeOps —— GitWorktreeOps 的真实实现，通过子进程调用 git
export class RealGitWorktreeOps implements GitWorktreeOps {
  private repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  async addWorktree(path: string, branch: string, baseBranch: string): Promise<void> {
    await execGit(this.repoRoot, [
      "worktree", "add", "-B", branch, path, baseBranch,
    ]);
  }

  async moveWorktree(fromPath: string, toPath: string): Promise<void> {
    await execGit(this.repoRoot, ["worktree", "move", fromPath, toPath]);
  }

  async removeWorktree(path: string, force: boolean): Promise<void> {
    const args = ["worktree", "remove"];
    if (force) args.push("--force");
    args.push(path);
    await execGit(this.repoRoot, args);
  }

  async deleteBranch(branch: string): Promise<void> {
    await execGit(this.repoRoot, ["branch", "-D", branch]);
  }

  async getBranchName(path: string): Promise<string> {
    try {
      return await execGitInWorktree(path, ["branch", "--show-current"]);
    } catch {
      // try git rev-parse as fallback
      try {
        return await execGitInWorktree(path, ["rev-parse", "--abbrev-ref", "HEAD"]);
      } catch {
        return "(unknown)";
      }
    }
  }

  async getHeadCommit(path: string): Promise<string> {
    return execGitInWorktree(path, ["rev-parse", "HEAD"]);
  }

  async hasUncommittedChanges(path: string): Promise<boolean> {
    try {
      const output = await execGitInWorktree(path, ["status", "--porcelain"]);
      return output.length > 0;
    } catch {
      // 目录可能不存在或损坏，保守返回 false（由上层决定如何处理）
      return false;
    }
  }

  async getCommitCountAhead(path: string, baseCommit: string): Promise<number> {
    try {
      const output = await execGitInWorktree(path, [
        "rev-list", "--count", `${baseCommit}..HEAD`,
      ]);
      return parseInt(output, 10) || 0;
    } catch {
      return 0;
    }
  }

  async listWorktrees(): Promise<string[]> {
    const output = await execGit(this.repoRoot, ["worktree", "list", "--porcelain"]);
    const paths: string[] = [];
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        paths.push(line.slice("worktree ".length));
      }
    }
    return paths;
  }

  async getLastModified(path: string): Promise<Date> {
    try {
      const output = await execGitInWorktree(path, [
        "log", "-1", "--format=%ct",
      ]);
      if (output) {
        const timestamp = parseInt(output, 10);
        return new Date(timestamp * 1000);
      }
    } catch {
      // 回退：使用文件系统时间
    }
    // fallback: 文件系统 stat
    try {
      const s = await stat(path);
      return s.mtime;
    } catch {
      return new Date(0); // epoch，当作非常老，便于清理
    }
  }

  async getHooksPath(repoRoot: string): Promise<string | null> {
    try {
      const hooksPath = await execGit(repoRoot, [
        "config", "--get", "core.hooksPath",
      ]);
      return hooksPath || null;
    } catch {
      return null;
    }
  }
}
