import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Tool, ToolContext, ToolResult, ToolInputSchema } from "../types.js";

const inputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    filePath: { type: "string", description: "要创建或覆盖的文件路径" },
    content: { type: "string", description: "要写入的完整文件内容" },
  },
  required: ["filePath", "content"],
};

export const writeFileTool: Tool = {
  name: "write_file",
  description: "创建新文件或覆盖已有文件。父目录不存在时会自动创建。",
  type: "file",
  readOnly: false,
  destructive: true,
  inputSchema,

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = resolve(context.cwd, params.filePath as string);
    const content = params.content as string;

    try {
      // 递归创建父目录
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, "utf-8");

      const bytes = Buffer.byteLength(content, "utf-8");
      return {
        status: "success",
        content: `确认写入 ${bytes} 字节到 ${filePath}`,
        metadata: { bytesWritten: bytes },
      };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "EACCES" || err.code === "EPERM") {
        return { status: "error", content: `权限不足，无法写入：${filePath}` };
      }
      return { status: "error", content: `写入失败：${err.message}` };
    }
  },
};
