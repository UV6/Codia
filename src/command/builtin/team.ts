import type { CommandDef, UIContext } from "../types.js";

function usage(ui: UIContext): void {
  ui.showMessage(
    "用法: /team create <teamName> <leadName> 或 /team list",
    "warning",
  );
}

export async function handleTeam(args: string, ui: UIContext): Promise<void> {
  const parts = args.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    usage(ui);
    return;
  }

  const action = parts[0];

  if (action === "list") {
    const teams = await ui.listTeams();
    if (teams.length === 0) {
      ui.showMessage("当前还没有 team。", "info");
      return;
    }
    ui.showMessage(`当前 team:\n${teams.map((name) => `- ${name}`).join("\n")}`, "info");
    return;
  }

  if (action === "create") {
    const teamName = parts[1];
    const leadName = parts[2];
    if (!teamName || !leadName) {
      usage(ui);
      return;
    }

    try {
      const team = await ui.createTeam(teamName, leadName);
      ui.showMessage(`team "${team.name}" 已创建，Lead 为 "${team.lead}"。`, "info");
    } catch (error) {
      ui.showMessage(`创建 team 失败：${(error as Error).message}`, "error");
    }
    return;
  }

  usage(ui);
}

export const teamCommand: CommandDef = {
  name: "team",
  aliases: [],
  description: "创建或查看 team",
  usage: "/team create <teamName> <leadName> | /team list",
  argsHint: "create <teamName> <leadName> | list",
  type: "local",
  handler: (args: string, ui: UIContext): void => {
    void handleTeam(args, ui);
  },
};
