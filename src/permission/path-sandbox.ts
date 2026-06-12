import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import type { PermissionRequest, PermissionResult } from "./types.js";

// 约定的路径参数名列表
const PATH_PARAM_NAMES = ["filePath", "path", "file_path"];

// extractPaths —— 从 params 中提取所有路径值
function extractPaths(params: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (
      PATH_PARAM_NAMES.includes(key) ||
      key.toLowerCase().endsWith("path") ||
      key.toLowerCase().endsWith("dir")
    ) {
      if (typeof value === "string" && value.trim() !== "") {
        paths.push(value);
      }
    }
  }
  return paths;
}

// resolveSandboxRoot —— 解析 cwd 的真实路径
function resolveSandboxRoot(cwd: string): string | null {
  try {
    return realpathSync(cwd);
  } catch {
    return null;
  }
}

// startsWithRoot —— 检查路径是否以 sandboxRoot 开头，允许 exact match
function startsWithRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(root + "/");
}

// isWithinSandbox —— 检查路径是否在沙箱内
// 同时用原始 cwd 和 realpath cwd 检查，兼容 macOS /tmp → /private/tmp 等符号链接场景
function isWithinSandbox(
  absolutePath: string,
  sandboxRoot: string,
  cwd: string,
): boolean {
  // 1. 尝试解析真实路径（已存在文件）
  try {
    const realPath = realpathSync(absolutePath);
    // 对比 realpath cwd
    if (startsWithRoot(realPath, sandboxRoot)) return true;
    // 对比原始 cwd 的真实路径
    try {
      const realCwd = realpathSync(cwd);
      if (startsWithRoot(realPath, realCwd)) return true;
    } catch {
      // ignore
    }
    return false;
  } catch {
    // 路径不存在（如创建新文件），做字符串前缀判断
  }

  // 2. 字符串前缀判断
  if (startsWithRoot(absolutePath, sandboxRoot)) return true;

  // 3. 用原始 cwd 的真实路径再尝试
  try {
    const realCwd = realpathSync(cwd);
    if (startsWithRoot(absolutePath, realCwd)) return true;
  } catch {
    // ignore
  }

  // 4. 原始 cwd 字符串
  return startsWithRoot(absolutePath, cwd);
}

// check —— 检查文件操作是否在沙箱内
export function check(request: PermissionRequest): PermissionResult | null {
  // 非文件工具不适用路径沙箱
  if (request.toolType !== "file") {
    return null;
  }

  const sandboxRoot = resolveSandboxRoot(request.cwd);
  if (!sandboxRoot) {
    return {
      decision: "deny",
      layer: 2,
      reason: `路径沙箱：项目目录 "${request.cwd}" 不存在或无法访问`,
    };
  }

  const paths = extractPaths(request.params);

  if (paths.length === 0) {
    return null;
  }

  for (const p of paths) {
    // 绝对路径
    if (p.startsWith("/")) {
      if (!isWithinSandbox(p, sandboxRoot, request.cwd)) {
        return {
          decision: "deny",
          layer: 2,
          reason: `路径沙箱：路径 "${p}" 超出了项目目录 "${sandboxRoot}"`,
        };
      }
      continue;
    }

    // 相对路径：resolve 后再检查
    const absolutePath = resolve(request.cwd, p);
    if (!isWithinSandbox(absolutePath, sandboxRoot, request.cwd)) {
      return {
        decision: "deny",
        layer: 2,
        reason: `路径沙箱：路径 "${p}"（解析后 "${absolutePath}"）超出了项目目录 "${sandboxRoot}"`,
      };
    }
  }

  return null;
}
