import { join } from "node:path";
import type { WorktreeConfig } from "./types.js";
import { ValidationError } from "./types.js";

// 允许的字符：字母、数字、点、下划线、连字符、斜杠
const VALID_CHARS = /^[a-zA-Z0-9._/-]+$/;
const MAX_LENGTH = 64;

// WorktreePath —— 值对象，封装校验逻辑和路径派生
export class WorktreePath {
  readonly name: string; // 原始输入，如 "sub/agent-x"
  readonly flatSlug: string; // name 中 / → +，如 "sub+agent-x"
  readonly branchName: string; // "worktree-" + flatSlug
  readonly fsPath: string; // worktreesDir + name 的完整文件系统路径

  private constructor(name: string, config: WorktreeConfig) {
    this.name = name;
    this.flatSlug = name.replace(/\//g, "+");
    this.branchName = `worktree-${this.flatSlug}`;
    this.fsPath = join(config.worktreesDir, name);
  }

  // validate —— 唯一构造入口，校验失败抛 ValidationError
  static validate(input: string, config: WorktreeConfig): WorktreePath {
    // 1. 空 / 纯空白
    if (!input || input.trim().length === 0) {
      throw new ValidationError("empty_segment", "目录名不能为空");
    }

    // 2. 长度限制
    if (input.length > MAX_LENGTH) {
      throw new ValidationError(
        "too_long",
        `目录名长度不能超过 ${MAX_LENGTH} 字符，当前 ${input.length} 字符`,
      );
    }

    // 3. 字符集检查
    if (!VALID_CHARS.test(input)) {
      throw new ValidationError(
        "invalid_chars",
        "目录名只能包含字母、数字、点号(.)、下划线(_)、连字符(-)、斜杠(/)",
      );
    }

    // 4. 以 / 开头或以 / 结尾
    if (input.startsWith("/")) {
      throw new ValidationError("absolute_path", "目录名不能以 / 开头（不允许绝对路径）");
    }
    if (input.endsWith("/")) {
      throw new ValidationError("absolute_path", "目录名不能以 / 结尾");
    }

    // 5. 包含 //
    if (input.includes("//")) {
      throw new ValidationError("empty_segment", "目录名不能包含连续的斜杠(//)");
    }

    // 6. 按 / 分段，检查独立段 . 或 ..
    const segments = input.split("/");
    for (const seg of segments) {
      if (seg === "." || seg === "..") {
        throw new ValidationError(
          "path_traversal",
          `目录名包含禁止的路径段："${seg}"，不允许路径遍历`,
        );
      }
    }

    // 校验通过：拼接完整的文件系统路径
    return new WorktreePath(input, config);
  }

  // isValid —— 仅校验，不抛异常
  static isValid(input: string): boolean {
    try {
      // 用一个最小 config 来驱动校验逻辑，但 isValid 只检查字符串本身，不关心 fsPath
      const dummyConfig: WorktreeConfig = {
        repoRoot: "",
        baseBranch: "",
        worktreesDir: "",
        copyPatterns: [],
        symlinkDirs: [],
      };
      WorktreePath.validate(input, dummyConfig);
      return true;
    } catch {
      return false;
    }
  }
}
