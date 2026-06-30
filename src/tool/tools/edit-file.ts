import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool, ToolContext, ToolResult, ToolInputSchema } from "../types.js";
import { buildCodiaFilePermissionRequest } from "../team-file-permission.js";

const inputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    filePath: { type: "string", description: "要编辑的文件路径" },
    oldString: { type: "string", description: "要替换的原文内容" },
    newString: { type: "string", description: "替换成的新内容" },
  },
  required: ["filePath", "oldString", "newString"],
};

// 统计字符串在原文中的出现次数
function countOccurrences(text: string, search: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

// 从匹配位置向前后扩展上下文行
function expandContext(
  lines: string[],
  matchLineIndex: number,
  contextLines: number,
): { start: number; end: number; context: string } {
  const start = Math.max(0, matchLineIndex - contextLines);
  const end = Math.min(lines.length - 1, matchLineIndex + contextLines);
  return {
    start,
    end,
    context: lines.slice(start, matchLineIndex).join("\n") + "\n" + lines[matchLineIndex] + "\n" + lines.slice(matchLineIndex + 1, end + 1).join("\n"),
  };
}

// 生成带行号的 diff 预览
function generateDiffPreview(
  lines: string[],
  oldString: string,
  matchStartLine: number,
): string {
  const matchLines = oldString.split("\n");
  const matchEndLine = matchStartLine + matchLines.length - 1;
  const previewStart = Math.max(0, matchStartLine - 3);
  const previewEnd = Math.min(lines.length - 1, matchEndLine + 3);

  const result: string[] = [];
  for (let i = previewStart; i <= previewEnd; i++) {
    if (i >= matchStartLine && i <= matchEndLine) {
      result.push(`${i + 1}: ❌ ${lines[i]}`);
    } else {
      result.push(`${i + 1}:    ${lines[i]}`);
    }
  }

  return result.join("\n");
}

export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "通过精确的原文匹配替换来编辑文件。需要提供要替换的原文和替换后的新文本。如果匹配不唯一，会自动扩展匹配上下文。调用前必须先用 read_file 读取文件确认当前内容。old_string 必须与文件原文完全一致。",
  type: "file",
  readOnly: false,
  destructive: true,
  inputSchema,
  buildPermissionRequest(params: Record<string, unknown>, context: ToolContext) {
    return buildCodiaFilePermissionRequest(params.filePath as string | undefined, context.cwd);
  },

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = resolve(context.cwd, params.filePath as string);
    const oldString = params.oldString as string;
    const newString = params.newString as string;

    try {
      const raw = readFileSync(filePath, "utf-8");
      const lines = raw.split("\n");
      let searchStr = oldString;

      let count = countOccurrences(raw, searchStr);

      // 0 次匹配
      if (count === 0) {
        return {
          status: "error",
          content: `未找到匹配内容。请检查 oldString 是否与文件中的原文完全一致（包括空格和换行）。`,
        };
      }

      // 多处匹配 → 逐步扩展上下文
      if (count > 1) {
        const fileLines = raw.split("\n");
        let expanded = oldString;
        let expandLeft = 0;
        let expandRight = 0;
        const maxExpandLeft = fileLines.length;
        const maxExpandRight = fileLines.length;

        while (count > 1 && (expandLeft < maxExpandLeft || expandRight < maxExpandRight)) {
          // 交替扩展
          if (expandLeft <= expandRight && expandLeft < maxExpandLeft) {
            expandLeft++;
            // 向前扩一行
            expanded = "\n" + expanded;
            // 在原文中找第一次出现位置的上一行
            const firstIdx = raw.indexOf(expanded.replace(/^\n/, ""));
            if (firstIdx > 0) {
              const lineStart = raw.lastIndexOf("\n", firstIdx - 1);
              if (lineStart >= 0) {
                expanded = raw.slice(lineStart, firstIdx) + "\n" + oldString;
              }
            }
          } else if (expandRight < maxExpandRight) {
            expandRight++;
            const firstIdx = raw.indexOf(oldString);
            const afterOld = firstIdx + oldString.length;
            const lineEnd = raw.indexOf("\n", afterOld);
            if (lineEnd >= 0) {
              expanded = oldString + raw.slice(afterOld, lineEnd);
            } else {
              expanded = oldString + raw.slice(afterOld);
            }
          }

          searchStr = expanded;
          const newCount = countOccurrences(raw, searchStr);
          count = newCount;
        }

        if (count === 0) {
          return {
            status: "error",
            content: `扩展上下文后未找到匹配。原匹配 "${oldString.slice(0, 80)}..." 出现 ${countOccurrences(raw, oldString)} 次，但扩展后未匹配到。`,
          };
        }

        if (count > 1) {
          return {
            status: "error",
            content: `匹配不唯一：原文 "${oldString.slice(0, 80)}..." 在文件中出现了 ${count} 处。请提供更多的上下文（包含前后行）以确保唯一匹配。`,
          };
        }
      }

      // 唯一匹配 → 替换
      const newRaw = raw.replace(searchStr, newString);
      writeFileSync(filePath, newRaw, "utf-8");

      // 找匹配行号生成 diff preview
      const matchIndex = raw.indexOf(searchStr);
      const beforeMatch = raw.slice(0, matchIndex);
      const matchStartLine = beforeMatch.split("\n").length - 1;

      const preview = generateDiffPreview(newRaw.split("\n"), newString, matchStartLine);

      return {
        status: "success",
        content: `替换成功。修改预览：\n${preview}`,
      };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return { status: "error", content: `文件不存在：${filePath}` };
      }
      return { status: "error", content: `编辑失败：${err.message}` };
    }
  },
};
