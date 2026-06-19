import type { ParseResult } from "./types.js";

// parseCommand —— 从原始输入文本解析命令名和参数
// 不以 / 开头 → 非命令；仅 / → 非命令
// 返回命令名（小写）和参数（trim）
export function parseCommand(input: string): ParseResult {
  const trimmed = input.trim();

  // 非 / 开头 → 非命令
  if (!trimmed.startsWith("/")) {
    return { isCommand: false, name: "", args: "" };
  }

  // 去掉 / 前缀
  const rest = trimmed.slice(1);

  // 仅 "/" → 非命令
  if (rest.length === 0) {
    return { isCommand: false, name: "", args: "" };
  }

  // 找第一个空格
  const spaceIdx = rest.indexOf(" ");

  const name = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();

  return { isCommand: true, name, args };
}
