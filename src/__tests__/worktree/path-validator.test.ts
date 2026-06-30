import { describe, it, expect } from "vitest";
import { WorktreePath } from "../../worktree/path-validator.js";
import { ValidationError } from "../../worktree/types.js";
import type { WorktreeConfig } from "../../worktree/types.js";

const config: WorktreeConfig = {
  repoRoot: "/tmp/test-repo",
  baseBranch: "main",
  worktreesDir: "/tmp/codia-home/projects/test-repo-id/worktrees",
  copyPatterns: [],
  symlinkDirs: [],
};

describe("WorktreePath", () => {
  describe("validate - 合法输入", () => {
    it("接受简单名称 agent-a3f2b1c", () => {
      const wp = WorktreePath.validate("agent-a3f2b1c", config);
      expect(wp.name).toBe("agent-a3f2b1c");
      expect(wp.flatSlug).toBe("agent-a3f2b1c");
      expect(wp.branchName).toBe("worktree-agent-a3f2b1c");
      expect(wp.fsPath).toBe("/tmp/codia-home/projects/test-repo-id/worktrees/agent-a3f2b1c");
    });

    it("接受嵌套名称 sub/agent-x，斜杠替换为 +", () => {
      const wp = WorktreePath.validate("sub/agent-x", config);
      expect(wp.name).toBe("sub/agent-x");
      expect(wp.flatSlug).toBe("sub+agent-x");
      expect(wp.branchName).toBe("worktree-sub+agent-x");
      expect(wp.fsPath).toBe("/tmp/codia-home/projects/test-repo-id/worktrees/sub/agent-x");
    });

    it("接受只含字母数字的名称", () => {
      const wp = WorktreePath.validate("hello123", config);
      expect(wp.name).toBe("hello123");
    });

    it("接受含点号的名称（如随机 hex 后缀）", () => {
      const wp = WorktreePath.validate("agent.a3f2b1c", config);
      expect(wp.name).toBe("agent.a3f2b1c");
    });

    it("接受含下划线和连字符的名称", () => {
      const wp = WorktreePath.validate("my_agent-test", config);
      expect(wp.name).toBe("my_agent-test");
    });

    it("边界：恰好 64 字符通过", () => {
      const name = "a".repeat(64);
      const wp = WorktreePath.validate(name, config);
      expect(wp.name).toBe(name);
    });
  });

  describe("validate - 非法输入", () => {
    it("拒绝空字符串", () => {
      expect(() => WorktreePath.validate("", config)).toThrow(ValidationError);
      try {
        WorktreePath.validate("", config);
      } catch (e) {
        expect((e as ValidationError).code).toBe("empty_segment");
      }
    });

    it("拒绝纯空白", () => {
      expect(() => WorktreePath.validate("   ", config)).toThrow(ValidationError);
      try {
        WorktreePath.validate("   ", config);
      } catch (e) {
        expect((e as ValidationError).code).toBe("empty_segment");
      }
    });

    it("拒绝超过 64 字符的名称", () => {
      const name = "a".repeat(65);
      expect(() => WorktreePath.validate(name, config)).toThrow(ValidationError);
      try {
        WorktreePath.validate(name, config);
      } catch (e) {
        expect((e as ValidationError).code).toBe("too_long");
      }
    });

    it("拒绝非法字符（空格）", () => {
      expect(() => WorktreePath.validate("hello world", config)).toThrow(ValidationError);
      try {
        WorktreePath.validate("hello world", config);
      } catch (e) {
        expect((e as ValidationError).code).toBe("invalid_chars");
      }
    });

    it("拒绝非法字符（特殊符号）", () => {
      expect(() => WorktreePath.validate("test@name", config)).toThrow(ValidationError);
    });

    it("拒绝 ../escape", () => {
      expect(() => WorktreePath.validate("../escape", config)).toThrow(ValidationError);
      try {
        WorktreePath.validate("../escape", config);
      } catch (e) {
        expect((e as ValidationError).code).toBe("path_traversal");
      }
    });

    it("拒绝 ./foo", () => {
      expect(() => WorktreePath.validate("./foo", config)).toThrow(ValidationError);
      try {
        WorktreePath.validate("./foo", config);
      } catch (e) {
        expect((e as ValidationError).code).toBe("path_traversal");
      }
    });

    it("拒绝 foo/../bar", () => {
      expect(() => WorktreePath.validate("foo/../bar", config)).toThrow(ValidationError);
      try {
        WorktreePath.validate("foo/../bar", config);
      } catch (e) {
        expect((e as ValidationError).code).toBe("path_traversal");
      }
    });

    it("拒绝 . 独立段", () => {
      expect(() => WorktreePath.validate(".", config)).toThrow(ValidationError);
      try {
        WorktreePath.validate(".", config);
      } catch (e) {
        expect((e as ValidationError).code).toBe("path_traversal");
      }
    });

    it("拒绝 .. 独立段", () => {
      expect(() => WorktreePath.validate("..", config)).toThrow(ValidationError);
      try {
        WorktreePath.validate("..", config);
      } catch (e) {
        expect((e as ValidationError).code).toBe("path_traversal");
      }
    });

    it("拒绝以 / 开头", () => {
      expect(() => WorktreePath.validate("/absolute", config)).toThrow(ValidationError);
      try {
        WorktreePath.validate("/absolute", config);
      } catch (e) {
        expect((e as ValidationError).code).toBe("absolute_path");
      }
    });

    it("拒绝以 / 结尾", () => {
      expect(() => WorktreePath.validate("trailing/", config)).toThrow(ValidationError);
      try {
        WorktreePath.validate("trailing/", config);
      } catch (e) {
        expect((e as ValidationError).code).toBe("absolute_path");
      }
    });

    it("拒绝 a//b 连续斜杠", () => {
      expect(() => WorktreePath.validate("a//b", config)).toThrow(ValidationError);
      try {
        WorktreePath.validate("a//b", config);
      } catch (e) {
        expect((e as ValidationError).code).toBe("empty_segment");
      }
    });
  });

  describe("isValid", () => {
    it("合法名返回 true", () => {
      expect(WorktreePath.isValid("agent-test")).toBe(true);
    });

    it("非法名返回 false", () => {
      expect(WorktreePath.isValid("../escape")).toBe(false);
      expect(WorktreePath.isValid("")).toBe(false);
      expect(WorktreePath.isValid("hello world")).toBe(false);
    });
  });
});
