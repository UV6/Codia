import type { CommandDef, UIContext } from "../types.js";

// getAllCommands —— 由外层注入，避免循环依赖
let getAllCommands: (() => CommandDef[]) | null = null;

export function setCommandProvider(provider: () => CommandDef[]): void {
  getAllCommands = provider;
}

function showSkills(_args: string, ui: UIContext): void {
  const commands = getAllCommands?.() ?? [];
  const skills = commands.filter((c) => c.type === "prompt");

  if (skills.length === 0) {
    ui.showMessage("当前没有可用的 Skill。", "info");
    return;
  }

  const lines = skills.map((c) => {
    const aliasesStr = c.aliases && c.aliases.length > 0
      ? ` (${c.aliases.join(", ")})`
      : "";
    return `  /${c.name}${aliasesStr} — ${c.description}`;
  });

  ui.showMessage(`可用 Skill:\n${lines.join("\n")}`, "info");
}

export const skillsCommand: CommandDef = {
  name: "skills",
  description: "显示所有可用的 Skill",
  usage: "/skills",
  type: "local",
  handler: showSkills,
};
