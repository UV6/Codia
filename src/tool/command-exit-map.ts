// 命令语义表：不同命令的正常退出码集合
// 未列出的命令默认只有 0 是正常退出
const COMMAND_EXIT_MAP: Record<string, number[]> = {
  grep: [0, 1], // 1 = 无匹配，不算错误
  diff: [0, 1], // 1 = 有差异，不算错误
  find: [0],
  ls: [0],
  cat: [0],
  head: [0],
  tail: [0],
  mkdir: [0],
  touch: [0],
};

// 从命令字符串中提取命令名（第一个空格前的部分，去掉路径前缀）
function extractCommandName(command: string): string {
  const trimmed = command.trim();
  // 去掉前导路径（如 /usr/bin/grep → grep）
  const parts = trimmed.split(/\s+/);
  const name = parts[0] ?? "";
  const basename = name.split("/").pop() ?? name;
  return basename;
}

// isSuccessfulExit —— 判断给定命令的退出码是否属于正常范围
export function isSuccessfulExit(command: string, exitCode: number): boolean {
  const name = extractCommandName(command);
  const okCodes = COMMAND_EXIT_MAP[name] ?? [0];
  return okCodes.includes(exitCode);
}
