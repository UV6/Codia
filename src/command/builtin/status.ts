import type { CommandDef, UIContext } from "../types.js";

function handleStatus(_args: string, ui: UIContext): void {
  const mode = ui.getMode();
  const modeLabel = mode === "plan" ? "PLAN" : "DEFAULT";
  const usage = ui.getTokenUsage();

  const lines: string[] = [
    `模式: [${modeLabel}]`,
  ];

  if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
    lines.push(`模型: ${usage.model}`);
    lines.push(`输入: ${usage.inputTokens} | 输出: ${usage.outputTokens}`);
  } else {
    lines.push("Token: 暂无用量数据");
  }

  ui.showMessage(lines.join("\n"), "info");
}

export const statusCommand: CommandDef = {
  name: "status",
  aliases: [],
  description: "显示 token 用量、模型、模式等状态",
  usage: "/status",
  type: "local",
  handler: handleStatus,
};
