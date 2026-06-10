import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import type { Tool, ToolContext, ToolResult, ToolInputSchema } from "../types.js";

const MAX_RESULTS = 200;

const inputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    pattern: { type: "string", description: "要搜索的文字或正则表达式" },
    dir: { type: "string", description: "搜索目录，默认当前工作目录" },
    include: { type: "string", description: "文件过滤 glob，如 *.ts 只搜索 TS 文件" },
  },
  required: ["pattern"],
};

export const grepTool: Tool = {
  name: "grep",
  description:
    "在文件中搜索匹配的文字或正则表达式。返回匹配行及其文件路径和行号。适合查找代码中的函数、类、变量等定义。",
  type: "search",
  readOnly: true,
  destructive: false,
  inputSchema,

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const pattern = params.pattern as string;
    const dir = resolve(context.cwd, (params.dir as string) ?? ".");
    const include = params.include as string | undefined;

    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      return { status: "error", content: `无效的正则表达式：${pattern}` };
    }

    try {
      const matches: string[] = [];
      walkAndGrep(dir, regex, include, matches, dir);

      const total = matches.length;
      const truncated = total > MAX_RESULTS;
      const shown = truncated ? matches.slice(0, MAX_RESULTS) : matches;

      let content = shown.join("\n") || "(无匹配结果)";
      if (truncated) {
        content += `\n\n... 还有 ${total - MAX_RESULTS} 条匹配未显示，请缩小搜索范围。`;
      }

      return {
        status: "success",
        content,
        metadata: { lineCount: total },
      };
    } catch (e) {
      return { status: "error", content: `搜索失败：${(e as Error).message}` };
    }
  },
};

function walkAndGrep(
  dir: string,
  regex: RegExp,
  include: string | undefined,
  results: string[],
  baseDir: string,
) {
  const ignoreDirs = new Set(["node_modules", ".git", ".claude", "dist", "__pycache__"]);

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(".") || ignoreDirs.has(entry)) continue;

    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walkAndGrep(fullPath, regex, include, results, baseDir);
    } else if (stat.isFile()) {
      if (results.length >= MAX_RESULTS) return;

      const relPath = relative(baseDir, fullPath);

      // 文件过滤
      if (include && !matchGlob(relPath, include)) continue;

      try {
        const raw = readFileSync(fullPath, "utf-8");
        const lines = raw.split("\n");
        for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
          if (regex.test(lines[i])) {
            results.push(`${relPath}:${i + 1}: ${lines[i].slice(0, 200)}`);
          }
        }
      } catch {
        // 跳过无法读取的文件
      }
    }
  }
}

function matchGlob(name: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\*\*/g, "___DS___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DS___/g, ".*");
  try {
    return new RegExp(`^${regexStr}$`).test(name);
  } catch {
    return name.includes(pattern.replace(/\*/g, ""));
  }
}
