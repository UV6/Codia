import type { CommandDef, UIContext } from "../types.js";

function handleBypass(_args: string, ui: UIContext): void {
  ui.setPermissionMode("bypassPermissions");
  ui.showMessage("已切换为 bypassPermissions 模式：仅黑名单拦截，其余放行。", "info");
}

export const bypassCommand: CommandDef = {
  name: "bypass",
  aliases: ["bp"],
  description: "切换为 bypassPermissions 危险模式（跳过权限确认，仅保留黑名单）",
  usage: "/bypass",
  type: "local",
  handler: handleBypass,
};
