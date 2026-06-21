import type { CommandDef, UIContext } from "../types.js";

function handleAcceptsEdit(_args: string, ui: UIContext): void {
  ui.setPermissionMode("acceptsEdit");
  ui.showMessage("已切换为 acceptsEdit 模式：只读+编辑放行，Bash 需确认。", "info");
}

export const acceptsEditCommand: CommandDef = {
  name: "acceptsedit",
  aliases: ["ae"],
  description: "切换为 acceptsEdit 权限模式（只读+编辑放行，Bash 需确认）",
  usage: "/acceptsedit",
  type: "local",
  handler: handleAcceptsEdit,
};
