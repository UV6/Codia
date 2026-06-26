import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommandDef, UIContext } from "../types.js";

const execFileAsync = promisify(execFile);

type ExecRunner = (
  file: string,
  args: readonly string[],
  options: { cwd: string; encoding: "utf-8"; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

const REVIEW_PROMPT = `请审查当前 git diff 中的代码变更。重点关注：

1. 逻辑错误
2. 安全问题
3. 性能问题
4. 代码风格

请给出具体的审查结论和改进建议。`;

export async function getWorkingDiff(
  cwd: string,
  runner: ExecRunner = execFileAsync as unknown as ExecRunner,
): Promise<string> {
  const { stdout } = await runner("git", ["diff"], {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
  });
  return stdout.trim();
}

export async function handleReview(
  args: string,
  ui: UIContext,
  runner?: ExecRunner,
): Promise<void> {
  try {
    const diff = await getWorkingDiff(ui.getCwd(), runner);
    if (!diff) {
      ui.showMessage("当前没有未暂存的代码变更。", "warning");
      return;
    }

    let prompt = `${REVIEW_PROMPT}\n\n${diff}`;
    if (args) {
      prompt += `\n\n额外关注：${args}`;
    }

    ui.sendUserMessage(prompt);
  } catch (err) {
    ui.showMessage(`读取 git diff 失败：${(err as Error).message}`, "error");
  }
}

export const reviewCommand: CommandDef = {
  name: "review",
  aliases: ["cr"],
  description: "触发代码审查",
  usage: "/review [额外关注点]",
  argsHint: "额外关注点",
  type: "local",
  handler: (args: string, ui: UIContext): void => {
    void handleReview(args, ui);
  },
};
