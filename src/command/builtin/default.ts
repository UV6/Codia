import type { CommandDef, UIContext } from "../types.js";

function handleDefault(_args: string, ui: UIContext): void {
  ui.setPermissionMode("default");
  ui.showMessage("已切换为 default 权限模式：只读放行，编辑+Bash 需确认。", "info");
}

export const defaultCommand: CommandDef = {
  name: "default",
  aliases: [],
  description: "切换为 default 权限模式（只读放行，编辑+Bash 需确认）",
  usage: "/default",
  type: "local",
  handler: handleDefault,
};
