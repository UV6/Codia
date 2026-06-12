import { exec, ChildProcess } from "node:child_process";
import type { Tool, ToolContext, ToolResult, ToolInputSchema } from "../types.js";
import { isSuccessfulExit } from "../command-exit-map.js";

const DEFAULT_TIMEOUT_SEC = 30;
const MAX_OUTPUT_CHARS = 10000;
const HEAD_CHARS = 2000;
const TAIL_CHARS = 8000;

const inputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    command: { type: "string", description: "要执行的 shell 命令" },
    cwd: { type: "string", description: "工作目录，默认项目根目录" },
    timeout: { type: "number", description: "超时秒数，默认 30 秒" },
  },
  required: ["command"],
};

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;

  const head = output.slice(0, HEAD_CHARS);
  const tail = output.slice(-TAIL_CHARS);
  const dropped = output.length - HEAD_CHARS - TAIL_CHARS;
  return `${head}\n... [已截断中间 ${dropped} 字符] ...\n${tail}`;
}

export const runCommandTool: Tool = {
  name: "run_command",
  description:
    "在终端中执行指定的 shell 命令。返回合并的标准输出和错误输出以及退出码。默认超时 30 秒。优先使用专用工具（read_file、edit_file、glob、grep）而非 cat、sed、echo 等 shell 命令。",
  type: "shell",
  readOnly: false,
  destructive: true,
  inputSchema,

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = params.command as string;
    const cwd = (params.cwd as string) ?? context.cwd;
    const timeoutSec = (params.timeout as number) ?? DEFAULT_TIMEOUT_SEC;

    const startTime = Date.now();

    try {
      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
        (resolve, reject) => {
          let child: ChildProcess;

          try {
            child = exec(
              command,
              {
                cwd,
                timeout: timeoutSec * 1000,
                maxBuffer: 1024 * 1024, // 1MB
                shell: "/bin/zsh",
              },
              (error, stdout, stderr) => {
                // Node.js exec 在非零退出码时也通过 error 回调
                if (error && (error as any).killed) {
                  reject(new Error("命令执行超时"));
                  return;
                }
                resolve({
                  stdout: stdout ?? "",
                  stderr: stderr ?? "",
                  exitCode: (error as any)?.code ?? 0,
                });
              },
            );
          } catch (e) {
            reject(new Error(`无法启动命令：${(e as Error).message}`));
            return;
          }

          // 超时处理
          const timeoutMs = timeoutSec * 1000;
          const timer = setTimeout(() => {
            if (child && child.exitCode === null) {
              child.kill("SIGTERM");
              // 2 秒后仍未退出则 SIGKILL
              setTimeout(() => {
                if (child && child.exitCode === null) {
                  child.kill("SIGKILL");
                }
              }, 2000);
            }
          }, timeoutMs);

          child.on("close", () => clearTimeout(timer));
        },
      );

      const combinedOutput = (result.stdout + (result.stderr ? "\n" + result.stderr : "")).trim();

      // 判断是否为成功退出
      const ok = isSuccessfulExit(command, result.exitCode);

      const output = truncateOutput(combinedOutput || "(无输出)");

      const content = `<output>\n${output}\n</output>\n<exit_code>${result.exitCode}</exit_code>`;

      return {
        status: ok ? "success" : "error",
        content,
        metadata: {
          exitCode: result.exitCode,
          duration: Date.now() - startTime,
        },
      };
    } catch (e) {
      const errMsg = (e as Error).message;
      if (errMsg.includes("超时")) {
        return {
          status: "error",
          content: `<output>\n(命令执行超时，${timeoutSec} 秒后被终止)\n</output>\n<exit_code>-1</exit_code>`,
          metadata: { duration: Date.now() - startTime },
        };
      }
      return {
        status: "error",
        content: `<output>\n命令执行失败：${errMsg}\n</output>\n<exit_code>-1</exit_code>`,
        metadata: { duration: Date.now() - startTime },
      };
    }
  },
};
