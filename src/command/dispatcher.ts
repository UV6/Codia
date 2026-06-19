import type { CommandDef, UIContext } from "./types.js";

// dispatch —— 根据命令类型执行不同路径
// local/ui: 直接调用 handler
// prompt: 取 cmd.promptText，通过 ui.sendUserMessage() 注入对话
export function dispatch(cmd: CommandDef, args: string, ui: UIContext): void {
  switch (cmd.type) {
    case "local":
    case "ui":
      cmd.handler(args, ui);
      break;
    case "prompt": {
      // prompt 型不调 handler，直接用 CommandDef.promptText
      const text = cmd.promptText
        ? args
          ? `${cmd.promptText}\n\n参数: ${args}`
          : cmd.promptText
        : args;
      ui.sendUserMessage(text);
      break;
    }
  }
}
