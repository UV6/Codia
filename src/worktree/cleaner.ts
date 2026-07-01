import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { minimatch } from "minimatch";
import type { WorktreeConfig, CleanupConfig, CleanupResult, GitWorktreeOps } from "./types.js";

// WorktreeCleaner —— 后台过期清理，三层过滤保证安全
export class WorktreeCleaner {
  private config: WorktreeConfig;
  private ops: GitWorktreeOps;

  constructor(config: WorktreeConfig, ops: GitWorktreeOps) {
    this.config = config;
    this.ops = ops;
  }

  // cleanup —— 执行过期清理
  async cleanup(cfg: CleanupConfig): Promise<CleanupResult> {
    const cleaned: string[] = [];
    const skipped: { name: string; reason: string }[] = [];

    // 列出 worktreesDir 下所有子目录
    let entries: string[];
    try {
      entries = readdirSync(this.config.worktreesDir);
    } catch {
      console.warn(`[WorktreeCleaner] 无法读取 worktrees 目录：${this.config.worktreesDir}`);
      return { cleaned, skipped };
    }

    for (const entry of entries) {
      const entryPath = join(this.config.worktreesDir, entry);

      // 只处理目录
      let isDir: boolean;
      try {
        isDir = statSync(entryPath).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;

      // ① 命名模式过滤：仅 autoPatterns 匹配的目录进入后续检查
      const nameMatches = cfg.autoPatterns.some((pattern) =>
        minimatch(entry, pattern),
      );
      if (!nameMatches) {
        skipped.push({ name: entry, reason: "命名模式不匹配（手动创建的目录）" });
        continue;
      }

      // ② 过期检查
      const lastModified = await this.ops.getLastModified(entryPath);
      if (lastModified >= cfg.cutoffDate) {
        skipped.push({
          name: entry,
          reason: `未过期（最后活动 ${lastModified.toISOString()}，阈值 ${cfg.cutoffDate.toISOString()}）`,
        });
        continue;
      }

      // ③ 变更保护
      try {
        const hasChanges = await this.ops.hasUncommittedChanges(entryPath);
        if (hasChanges) {
          skipped.push({ name: entry, reason: "有未提交修改，跳过" });
          continue;
        }

        let commitCountAhead = 0;
        try {
          const headCommit = await this.ops.getHeadCommit(entryPath);
          commitCountAhead = await this.ops.getCommitCountAhead(entryPath, headCommit);
        } catch {
          // 无法获取 commit 信息，保守跳过
        }
        if (commitCountAhead > 0) {
          skipped.push({
            name: entry,
            reason: `有 ${commitCountAhead} 个未合并的 commit，跳过`,
          });
          continue;
        }
      } catch {
        skipped.push({ name: entry, reason: "变更检查失败，跳过" });
        continue;
      }

      // 通过全部三层过滤，执行清理
      try {
        const branchName = await this.ops.getBranchName(entryPath);
        await this.ops.removeWorktree(entryPath, true);
        if (branchName && branchName !== "(unknown)") {
          try {
            await this.ops.deleteBranch(branchName);
          } catch {
            console.warn(`[WorktreeCleaner] 无法删除分支：${branchName}`);
          }
        }
        cleaned.push(entry);
        console.error(`[WorktreeCleaner] 已清理：${entry}（分支：${branchName}）`);
      } catch (e) {
        skipped.push({
          name: entry,
          reason: `清理失败：${(e as Error).message}`,
        });
      }
    }

    return { cleaned, skipped };
  }
}
