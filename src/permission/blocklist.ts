import type { PermissionResult } from "./types.js";

// DANGEROUS_PATTERNS —— 内置危险命令正则列表，Layer 1 不可绕过
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // 递归强制删除根目录
  { pattern: /rm\s+(-[rRf]+\s+)*\/[^a-zA-Z0-9]*$/, description: "递归强制删除系统根目录" },
  // 格式化文件系统
  { pattern: /mkfs\.\S+/, description: "格式化文件系统" },
  // 裸 dd 写盘
  { pattern: /dd\s+if=.*of=\/dev\/(sd[a-z]|nvme|hd)/, description: "直接写块设备" },
  // 直接写块设备
  { pattern: />\s*\/dev\/(sd[a-z]|nvme|hd)/, description: "重定向写入块设备" },
  // 根目录权限放宽
  { pattern: /chmod\s+(-[Rr]+\s+)?777\s+\//, description: "将系统根目录权限设为 777" },
  // fork 炸弹
  { pattern: /:\(\)\s*\{/, description: "fork 炸弹" },
  // 递归删除整个文件系统
  { pattern: /rm\s+(-[rRf]+\s+)+\/\*/, description: "递归强制删除根目录下所有文件" },
  // chown 系统关键目录
  { pattern: /chown\s+(-[Rr]+\s+)?\S+\s+\/(etc|usr|bin|sbin|lib|boot)/, description: "更改系统关键目录所有权" },
];

// check —— 扫描命令字符串，命中危险模式返回 deny，否则 null
export function check(command: string | unknown): PermissionResult | null {
  if (typeof command !== "string" || command.trim() === "") {
    return null;
  }

  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        decision: "deny",
        layer: 1,
        reason: `黑名单拦截：${description}（匹配: ${command.slice(0, 80)}）`,
      };
    }
  }

  return null;
}
