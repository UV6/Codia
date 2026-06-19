import type { CommandDef, UIContext } from "../types.js";

function handleDo(_args: string, ui: UIContext): void {
  if (ui.getMode() === "plan") {
    ui.setMode("full");
    ui.showMessage("已退出计划模式，回到执行模式 [DEFAULT]。", "info");
  } else {
    ui.showMessage("当前已在执行模式。", "info");
  }
}

export const doCommand: CommandDef = {
  name: "do",
  aliases: [],
  description: "退出计划模式，回到执行模式",
  usage: "/do",
  type: "ui",
  handler: handleDo,
};
