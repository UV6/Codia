import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { GitWorktreeOps, WorktreeMigrationResult } from "./types.js";

function isWithinRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(root + "/");
}

export async function migrateLegacyWorktrees(
  legacyRoot: string,
  targetRoot: string,
  ops: GitWorktreeOps,
): Promise<WorktreeMigrationResult> {
  const moved: WorktreeMigrationResult["moved"] = [];
  const skipped: WorktreeMigrationResult["skipped"] = [];
  const legacy = resolve(legacyRoot);
  const target = resolve(targetRoot);

  if (legacy === target) {
    return { moved, skipped };
  }

  if (!ops.moveWorktree) {
    throw new Error("当前 GitWorktreeOps 未实现 moveWorktree");
  }

  const worktrees = await ops.listWorktrees();
  for (const path of worktrees) {
    const current = resolve(path);
    if (!isWithinRoot(current, legacy)) {
      continue;
    }

    const rel = relative(legacy, current);
    const destination = join(target, rel);

    if (existsSync(destination)) {
      skipped.push({ path: current, reason: `目标路径已存在：${destination}` });
      continue;
    }

    mkdirSync(dirname(destination), { recursive: true });
    await ops.moveWorktree(current, destination);
    moved.push({ from: current, to: destination });
  }

  return { moved, skipped };
}
