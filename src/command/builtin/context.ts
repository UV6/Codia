import type { CommandDef, UIContext } from "../types.js";

function formatTokens(n: number): string {
  if (n >= 1000) {
    return (n / 1000).toFixed(1) + "K";
  }
  return String(n);
}

function handleContext(_args: string, ui: UIContext): void {
  const ctx = ui.getContextInfo();
  const pct = ctx.maxTokens > 0
    ? ((ctx.estimatedTokens / ctx.maxTokens) * 100).toFixed(1)
    : "0.0";

  const lines: string[] = [
    `上下文估算: ${formatTokens(ctx.estimatedTokens)} / ${formatTokens(ctx.maxTokens)} token (${pct}%)`,
    `消息数: ${ctx.messageCount} 条`,
  ];

  ui.showMessage(lines.join("\n"), "info");
}

export const contextCommand: CommandDef = {
  name: "context",
  aliases: ["ctx"],
  description: "显示当前上下文 token 估算",
  usage: "/context",
  type: "local",
  handler: handleContext,
};
