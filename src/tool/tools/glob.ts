import { resolve, join, relative } from "node:path";
import { globSync, readdirSync, statSync } from "node:fs";
import type { Tool, ToolContext, ToolResult, ToolInputSchema } from "../types.js";

const MAX_RESULTS = 200;

const inputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    pattern: { type: "string", description: "文件匹配模式，如 *.ts、src/**/*.go" },
    dir: { type: "string", description: "搜索起始目录，默认当前工作目录" },
  },
  required: ["pattern"],
};

export const globTool: Tool = {
  name: "glob",
  description:
    "按模式匹配文件路径。支持 ** 递归匹配子目录，如 src/**/*.ts 匹配 src 下所有 TypeScript 文件。",
  type: "search",
  readOnly: true,
  destructive: false,
  inputSchema,

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const pattern = params.pattern as string;
    const dir = resolve(context.cwd, (params.dir as string) ?? ".");

    try {
      // 用 fs.globSync（Node.js 22+），如果不支持则手动递归
      let results: string[];
      try {
        results = globSync(pattern, { cwd: dir, exclude: ["node_modules"] as any });
      } catch {
        // 降级：手动 glob
        results = manualGlob(dir, pattern);
      }

      const total = results.length;
      const truncated = total > MAX_RESULTS;
      const shown = truncated ? results.slice(0, MAX_RESULTS) : results;

      let content = shown.map((f) => `- ${f}`).join("\n") || "(无匹配文件)";
      if (truncated) {
        content += `\n\n... 还有 ${total - MAX_RESULTS} 个文件未列出，请缩小搜索范围。`;
      }

      return {
        status: "success",
        content,
        metadata: { fileCount: total },
      };
    } catch (e) {
      return { status: "error", content: `搜索失败：${(e as Error).message}` };
    }
  },
};

// 手动递归 glob（Node.js 22 以下降级方案）
function manualGlob(dir: string, pattern: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string, baseDir: string) {
    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const fullPath = join(currentDir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        // 递归匹配 **
        if (pattern.includes("**")) {
          walk(fullPath, baseDir);
        }
      } else if (stat.isFile()) {
        // 简单文件名匹配
        const relPath = relative(baseDir, fullPath);
        if (matchSimple(entry, pattern) || matchSimple(relPath, pattern)) {
          results.push(relPath);
        }
      }
    }
  }

  walk(dir, dir);
  return results;
}

function matchSimple(name: string, pattern: string): boolean {
  // 简单 glob：* 匹配任意字符（非路径分隔符）
  const regexStr = pattern
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*");
  try {
    return new RegExp(`^${regexStr}$`).test(name);
  } catch {
    return name.includes(pattern.replace(/\*/g, ""));
  }
}
