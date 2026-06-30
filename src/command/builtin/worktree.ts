import type { CommandDef, UIContext } from "../types.js";

function usage(ui: UIContext): void {
  ui.showMessage("用法: /worktree migrate", "warning");
}

export async function handleWorktree(args: string, ui: UIContext): Promise<void> {
  const parts = args.split(/\s+/).filter(Boolean);
  const action = parts[0];

  if (!action || action !== "migrate") {
    usage(ui);
    return;
  }

  try {
    if (!ui.migrateLegacyWorktrees) {
      ui.showMessage("当前界面不支持 worktree 迁移。", "error");
      return;
    }
    const result = await ui.migrateLegacyWorktrees();
    if (result.moved.length === 0 && result.skipped.length === 0) {
      ui.showMessage("没有检测到需要迁移的旧 worktree。", "info");
      return;
    }

    const lines: string[] = [];
    if (result.moved.length > 0) {
      lines.push(`已迁移 ${result.moved.length} 个 worktree:`);
      for (const item of result.moved) {
        lines.push(`- ${item.from} -> ${item.to}`);
      }
    }
    if (result.skipped.length > 0) {
      lines.push(`跳过 ${result.skipped.length} 个 worktree:`);
      for (const item of result.skipped) {
        lines.push(`- ${item.path} (${item.reason})`);
      }
    }
    ui.showMessage(lines.join("\n"), "info");
  } catch (error) {
    ui.showMessage(`迁移 worktree 失败：${(error as Error).message}`, "error");
  }
}

export const worktreeCommand: CommandDef = {
  name: "worktree",
  aliases: [],
  description: "执行 worktree 维护操作",
  usage: "/worktree migrate",
  argsHint: "migrate",
  type: "local",
  handler: (args: string, ui: UIContext): void => {
    void handleWorktree(args, ui);
  },
};
