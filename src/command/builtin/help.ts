import type { CommandDef, UIContext } from "../types.js";

// getAllCommands —— 由外层注入，避免循环依赖
let getAllCommands: (() => CommandDef[]) | null = null;

export function setCommandProvider(provider: () => CommandDef[]): void {
  getAllCommands = provider;
}

function showHelp(args: string, ui: UIContext): void {
  const commands = getAllCommands?.() ?? [];

  if (args) {
    // 查看特定命令详情
    const cmd = commands.find((c) => c.name === args || c.aliases?.includes(args));
    if (cmd) {
      const aliasesStr = cmd.aliases && cmd.aliases.length > 0
        ? ` (别名: ${cmd.aliases.join(", ")})`
        : "";
      const usageStr = cmd.usage ?? `/${cmd.name}`;
      ui.showMessage(
        `/${cmd.name}${aliasesStr}\n  类型: ${cmd.type}\n  说明: ${cmd.description}\n  用法: ${usageStr}`,
        "info",
      );
    } else {
      ui.showMessage(`未知命令: ${args}`, "warning");
    }
    return;
  }

  // 列出所有可见命令
  const lines = commands.map(
    (c) => {
      const aliasesStr = c.aliases && c.aliases.length > 0
        ? ` (${c.aliases.join(", ")})`
        : "";
      const usageStr = c.usage ?? `/${c.name}`;
      return `  ${usageStr}${aliasesStr} — ${c.description}`;
    },
  );

  ui.showMessage(
    `可用命令:\n${lines.join("\n")}\n\n输入 /help <命令名> 查看具体命令详情`,
    "info",
  );
}

export const helpCommand: CommandDef = {
  name: "help",
  aliases: ["h", "?"],
  description: "显示帮助信息",
  usage: "/help [command]",
  type: "local",
  argsHint: "[command]",
  handler: showHelp,
};
