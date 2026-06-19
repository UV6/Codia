import type { CommandDef, UIContext } from "../types.js";

function handleClear(_args: string, ui: UIContext): void {
  ui.clearMessages();
}

export const clearCommand: CommandDef = {
  name: "clear",
  aliases: ["cls"],
  description: "清空聊天界面",
  usage: "/clear",
  type: "ui",
  handler: handleClear,
};
