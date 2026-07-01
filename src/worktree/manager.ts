import type {
  WorktreeConfig,
  WorktreeInfo,
  ExitResult,
  GitWorktreeOps,
} from "./types.js";
import { WorktreePath } from "./path-validator.js";
import { WorktreeInitializer } from "./initializer.js";
import { WorktreeCreator } from "./creator.js";
import { WorktreeCleaner } from "./cleaner.js";

// WorktreeNotFoundError —— 操作不存在的 worktree 时抛出
export class WorktreeNotFoundError extends Error {
  constructor(name: string) {
    super(`Worktree "${name}" 不存在`);
    this.name = "WorktreeNotFoundError";
  }
}

// WorktreeManager —— 核心编排器，暴露 create/enter/exit/delete 统一接口
export class WorktreeManager {
  private config: WorktreeConfig;
  private ops: GitWorktreeOps;
  private creator: WorktreeCreator;
  private cleaner: WorktreeCleaner;

  constructor(config: WorktreeConfig, ops: GitWorktreeOps) {
    this.config = config;
    this.ops = ops;
    const initializer = new WorktreeInitializer(config, ops);
    this.creator = new WorktreeCreator(config, ops, initializer);
    this.cleaner = new WorktreeCleaner(config, ops);
  }

  // enter —— 创建 worktree 并返回 cwd 路径
  async enter(name: string): Promise<{ cwd: string; info: WorktreeInfo }> {
    const wp = WorktreePath.validate(name, this.config);
    console.error(`[WorktreeManager] 进入 worktree: ${name} (${wp.fsPath})`);
    const info = await this.creator.create(wp);
    console.error(`[WorktreeManager] worktree 就绪: ${info.path}`);
    return { cwd: info.path, info };
  }

  // exit —— 退出 worktree，根据变更情况决定清理或保留
  async exit(
    name: string,
    options?: { force?: boolean; keep?: boolean },
  ): Promise<ExitResult> {
    const wp = WorktreePath.validate(name, this.config);

    // 检查 worktree 是否存在
    const trees = await this.ops.listWorktrees();
    if (!trees.some((t) => t === wp.fsPath)) {
      throw new WorktreeNotFoundError(name);
    }

    const info = await this.buildInfo(wp);
    console.error(`[WorktreeManager] 退出 worktree: ${name}`);

    // keep 模式：仅标记，不改文件系统
    if (options?.keep) {
      console.error(`[WorktreeManager] worktree 保留: ${info.path}`);
      return { action: "kept", path: info.path, info };
    }

    // 检查变更
    const force = options?.force ?? false;
    if (!force) {
      if (!info.isClean || info.commitCountAhead > 0) {
        const reasons: string[] = [];
        if (!info.isClean) reasons.push("有未提交修改");
        if (info.commitCountAhead > 0) reasons.push(`${info.commitCountAhead} 个本地 commit`);

        const warning = `无法删除 worktree "${name}"：${reasons.join("，")}。使用 force 强制删除。`;
        console.warn(`[WorktreeManager] ${warning}`);
        return { action: "kept", path: info.path, info, warning };
      }
    }

    // 执行删除
    try {
      await this.ops.removeWorktree(info.path, force);
    } catch (e) {
      throw new Error(`删除 worktree 失败：${(e as Error).message}`);
    }

    try {
      await this.ops.deleteBranch(info.branch);
    } catch {
      console.warn(`[WorktreeManager] 删除分支失败：${info.branch}，目录已移除`);
    }

    console.error(`[WorktreeManager] worktree 已删除: ${info.path}`);
    return { action: "removed", path: info.path, info };
  }

  // delete —— 直接强制删除
  async delete(name: string, force = true): Promise<void> {
    const wp = WorktreePath.validate(name, this.config);

    const trees = await this.ops.listWorktrees();
    if (!trees.some((t) => t === wp.fsPath)) {
      throw new WorktreeNotFoundError(name);
    }

    console.error(`[WorktreeManager] 强制删除 worktree: ${name}`);
    await this.ops.removeWorktree(wp.fsPath, force);
    try {
      await this.ops.deleteBranch(wp.branchName);
    } catch {
      // 分支可能已被删除或其他问题，忽略
    }
  }

  // info —— 获取 worktree 元数据
  async info(name: string): Promise<WorktreeInfo> {
    const wp = WorktreePath.validate(name, this.config);
    const trees = await this.ops.listWorktrees();
    if (!trees.some((t) => t === wp.fsPath)) {
      throw new WorktreeNotFoundError(name);
    }
    return this.buildInfo(wp);
  }

  // list —— 列出所有 worktree
  async list(): Promise<WorktreeInfo[]> {
    const trees = await this.ops.listWorktrees();
    const infos: WorktreeInfo[] = [];
    for (const path of trees) {
      // 只处理 worktreesDir 下的 worktree
      if (!path.startsWith(this.config.worktreesDir)) continue;

      const name = path.slice(this.config.worktreesDir.length + 1); // 去掉前导 /
      try {
        const wp = WorktreePath.validate(name, this.config);
        const info = await this.buildInfo(wp);
        infos.push(info);
      } catch {
        // 跳过解析失败的
      }
    }
    return infos;
  }

  // getCleaner —— 暴露 cleaner 供外部定时调用
  getCleaner(): WorktreeCleaner {
    return this.cleaner;
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

    let lastModified: Date;
    try {
      lastModified = await this.ops.getLastModified(wp.fsPath);
    } catch {
      lastModified = now;
    }

    return {
      name: wp.name,
      path: wp.fsPath,
      branch: wp.branchName,
      headCommit,
      createdAt: now, // 无法从 git 获取精确创建时间，使用当前时间
      lastActivityAt: lastModified,
      isClean,
      commitCountAhead,
    };
  }
}
