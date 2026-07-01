import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { WorktreeConfig, WorktreeInfo, GitWorktreeOps } from "./types.js";
import type { WorktreePath } from "./path-validator.js";
import { WorktreeInitializer } from "./initializer.js";

// WorktreeCreator —— 工作目录创建编排，含幂等检测和错误回滚
export class WorktreeCreator {
  private config: WorktreeConfig;
  private ops: GitWorktreeOps;
  private initializer: WorktreeInitializer;

  constructor(config: WorktreeConfig, ops: GitWorktreeOps, initializer: WorktreeInitializer) {
    this.config = config;
    this.ops = ops;
    this.initializer = initializer;
  }

  // create —— 创建 worktree 并返回元数据
  async create(wp: WorktreePath): Promise<WorktreeInfo> {
    // 0. 确保 worktreesDir 存在
    mkdirSync(this.config.worktreesDir, { recursive: true });

    // 1. 幂等检测：目录已存在且在 worktree 列表中
    if (existsSync(wp.fsPath)) {
      try {
        const trees = await this.ops.listWorktrees();
        if (trees.some((t) => t === wp.fsPath)) {
          console.error(`[WorktreeCreator] 目录已存在，复用：${wp.fsPath}`);
          return this.buildInfo(wp);
        }
      } catch {
        // listWorktrees 失败，继续尝试新建
      }
    }

    // 2. 仅当 worktree 仍落在仓库内时，确保 .codia/ 在 .gitignore 中
    this.ensureGitignore();

    // 3. 创建 worktree
    try {
      await this.ops.addWorktree(wp.fsPath, wp.branchName, this.config.baseBranch);
    } catch (e) {
      throw new Error(`无法创建 git worktree：${(e as Error).message}`);
    }

    // 4. 初始化环境（失败时回滚）
    try {
      await this.initializer.initialize(wp.fsPath, this.config.repoRoot);
    } catch (e) {
      console.error(`[WorktreeCreator] 初始化失败，回滚：${(e as Error).message}`);
      await this.rollback(wp);
      throw new Error(
        `Worktree 创建成功但环境初始化失败，已回滚 worktree：${(e as Error).message}`,
      );
    }

    return this.buildInfo(wp);
  }

  // ensureGitignore —— 检查并确保 .codia/ 目录被 git 忽略
  private ensureGitignore(): void {
    if (!resolve(this.config.worktreesDir).startsWith(resolve(this.config.repoRoot) + "/")) {
      return;
    }

    const gitignorePath = `${this.config.repoRoot}/.gitignore`;

    try {
      // 使用 git check-ignore 检查
      execFileSync("git", ["check-ignore", "-q", ".codia/"], {
        cwd: this.config.repoRoot,
      });
      // 命令成功，表示已被忽略
    } catch {
      // 命令失败，表示未被忽略，需要添加
      const line = ".codia/";
      try {
        if (existsSync(gitignorePath)) {
          const content = readFileSync(gitignorePath, "utf-8");
          if (!content.includes(line)) {
            appendFileSync(gitignorePath, `\n${line}\n`);
          }
        } else {
          appendFileSync(gitignorePath, `${line}\n`);
        }
        console.error("[WorktreeCreator] 已将 .codia/ 加入 .gitignore");
      } catch (e) {
        console.warn(`[WorktreeCreator] 无法更新 .gitignore：${(e as Error).message}`);
      }
    }
  }

  // rollback —— 清理失败的 worktree
  private async rollback(wp: WorktreePath): Promise<void> {
    try {
      await this.ops.removeWorktree(wp.fsPath, true);
      await this.ops.deleteBranch(wp.branchName);
      console.error(`[WorktreeCreator] 回滚成功：${wp.fsPath}`);
    } catch (e) {
      console.error(
        `[WorktreeCreator] 严重错误：回滚失败，worktree 可能处于损坏状态。` +
        `路径：${wp.fsPath}，分支：${wp.branchName}。` +
        `错误：${(e as Error).message}。请手动执行 git worktree remove 和 git branch -D 清理。`,
      );
      // 尝试 git worktree prune 清理元数据
      try {
        execFileSync("git", ["worktree", "prune"], {
          cwd: this.config.repoRoot,
        });
        console.error("[WorktreeCreator] git worktree prune 已执行");
      } catch {
        // prune 也失败，放弃
      }
    }
  }

  // buildInfo —— 构造 WorktreeInfo
  private async buildInfo(wp: WorktreePath): Promise<WorktreeInfo> {
    const now = new Date();
    let headCommit: string;
    let isClean: boolean;
    let commitCountAhead: number;

    try {
      headCommit = await this.ops.getHeadCommit(wp.fsPath);
    } catch {
      headCommit = "(unknown)";
    }

    try {
      isClean = !(await this.ops.hasUncommittedChanges(wp.fsPath));
    } catch {
      isClean = true;
    }

    try {
      commitCountAhead = await this.ops.getCommitCountAhead(wp.fsPath, headCommit);
    } catch {
      commitCountAhead = 0;
    }

    return {
      name: wp.name,
      path: wp.fsPath,
      branch: wp.branchName,
      headCommit,
      createdAt: now,
      lastActivityAt: now,
      isClean,
      commitCountAhead,
    };
  }
}
