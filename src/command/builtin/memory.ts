import type { CommandDef, UIContext } from "../types.js";

// memoryInfo —— 由外层注入
let getMemoryInfo: (() => string) | null = null;

export function setMemoryInfoProvider(provider: () => string): void {
  getMemoryInfo = provider;
}

function handleMemory(_args: string, ui: UIContext): void {
  const info = getMemoryInfo?.() ?? "记忆状态不可用";
  ui.showMessage(info, "info");
}

export const memoryCommand: CommandDef = {
  name: "memory",
  aliases: [],
  description: "查看记忆存储状态",
  usage: "/memory",
  type: "local",
  handler: handleMemory,
};
