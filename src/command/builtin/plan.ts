import type { CommandDef, UIContext } from "../types.js";

function handlePlan(args: string, ui: UIContext): void {
  ui.setMode("plan");

  if (args) {
    // 带参数时同时注入提示词
    ui.sendUserMessage(args);
  } else {
    ui.showMessage("已进入计划模式 [PLAN]。使用 /do 退出。", "info");
  }
}

export const planCommand: CommandDef = {
  name: "plan",
  aliases: [],
  description: "进入计划模式，可选带提示词",
  usage: "/plan [message]",
  type: "ui",
  argsHint: "[message]",
  handler: handlePlan,
};
