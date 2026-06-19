import type { CommandDef, UIContext } from "../types.js";

function handleCompact(_args: string, ui: UIContext): void {
  ui.triggerCompact();
  ui.showMessage("已触发上下文压缩", "info");
}

export const compactCommand: CommandDef = {
  name: "compact",
  aliases: [],
  description: "手动触发上下文压缩",
  usage: "/compact",
  type: "local",
  handler: handleCompact,
};
