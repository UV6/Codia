import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool, ToolContext, ToolResult, ToolInputSchema } from "../types.js";

const inputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    filePath: { type: "string", description: "要读取的文件路径（绝对或相对）" },
    offset: { type: "number", description: "起始行号，默认 1" },
    limit: { type: "number", description: "读取行数上限，默认全部" },
  },
  required: ["filePath"],
};

// 二进制文件检测：读前 512 字节，有 null byte 则为二进制
function isBinary(filePath: string): boolean {
  const fd = require("node:fs").openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(512);
    const bytesRead = require("node:fs").readSync(fd, buf, 0, 512, 0);
    return buf.slice(0, bytesRead).includes(0);
  } finally {
    require("node:fs").closeSync(fd);
  }
}

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "读取指定文件的内容。对于文本文件返回带行号的内容；二进制文件无法直接读取。",
  type: "file",
  readOnly: true,
  destructive: false,
  inputSchema,

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = resolve(context.cwd, params.filePath as string);
    const offset = (params.offset as number) ?? 1;
    const limit = params.limit as number | undefined;

    try {
      // 二进制检查
      if (isBinary(filePath)) {
        return {
          status: "error",
          content: `文件 "${filePath}" 是二进制文件，无法直接读取文本内容。请用 run_command 工具执行 cat 等命令读取。`,
        };
      }

      const raw = readFileSync(filePath, "utf-8");
      const lines = raw.split("\n");
      const start = Math.max(0, offset - 1);
      const end = limit ? start + limit : lines.length;
      const selected = lines.slice(start, end);

      // 添加行号
      const numbered = selected
        .map((line, i) => `${start + i + 1}: ${line}`)
        .join("\n");

      return {
        status: "success",
        content: numbered || "(空文件)",
        metadata: { lineCount: selected.length },
      };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return { status: "error", content: `文件不存在：${filePath}` };
      }
      return { status: "error", content: `读取失败：${err.message}` };
    }
  },
};
