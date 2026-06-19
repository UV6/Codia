import type { CommandDef, UIContext } from "../types.js";

// sessionInfo —— 由外层在创建 UIContext 时注入
let getSessionInfo: (() => string) | null = null;

export function setSessionInfoProvider(provider: () => string): void {
  getSessionInfo = provider;
}

function handleSession(_args: string, ui: UIContext): void {
  const info = getSessionInfo?.() ?? "会话信息不可用";
  ui.showMessage(info, "info");
}

export const sessionCommand: CommandDef = {
  name: "session",
  aliases: [],
  description: "查看当前会话信息",
  usage: "/session",
  type: "local",
  handler: handleSession,
};
