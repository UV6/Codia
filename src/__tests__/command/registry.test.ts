import { describe, it, expect } from "vitest";
import { CommandRegistry } from "../../command/registry.js";
import type { CommandDef, UIContext } from "../../command/types.js";

function noopHandler(): void {}

function makeCmd(overrides: Partial<CommandDef> & { name: string }): CommandDef {
  return {
    description: "test command",
    type: "local",
    handler: noopHandler,
    ...overrides,
  };
}

describe("CommandRegistry", () => {
  describe("register and get", () => {
    it("注册并按名称查找", () => {
      const reg = new CommandRegistry();
      const cmd = makeCmd({ name: "test" });
      reg.register(cmd);

      expect(reg.get("test")).toBe(cmd);
    });

    it("未注册命令返回 undefined", () => {
      const reg = new CommandRegistry();
      expect(reg.get("nonexistent")).toBeUndefined();
    });

    it("别名查找", () => {
      const reg = new CommandRegistry();
      const cmd = makeCmd({ name: "help", aliases: ["h", "?"] });
      reg.register(cmd);

      expect(reg.get("h")).toBe(cmd);
      expect(reg.get("?")).toBe(cmd);
    });

    it("同名命令重复注册 throw", () => {
      const reg = new CommandRegistry();
      reg.register(makeCmd({ name: "test" }));

      expect(() => reg.register(makeCmd({ name: "test" }))).toThrow(
        '命令 "test" 已注册',
      );
    });

    it("别名与已有名称冲突 throw", () => {
      const reg = new CommandRegistry();
      reg.register(makeCmd({ name: "help" }));

      expect(() =>
        reg.register(makeCmd({ name: "other", aliases: ["help"] })),
      ).toThrow('别名 "help" 与已有命令名冲突');
    });

    it("别名与已有别名冲突 throw", () => {
      const reg = new CommandRegistry();
      reg.register(makeCmd({ name: "cmd1", aliases: ["x"] }));

      expect(() =>
        reg.register(makeCmd({ name: "cmd2", aliases: ["x"] })),
      ).toThrow('别名 "x" 已被命令 "cmd1" 使用');
    });

    it("别名数组内部重复 throw", () => {
      const reg = new CommandRegistry();

      expect(() =>
        reg.register(makeCmd({ name: "test", aliases: ["h", "h"] })),
      ).toThrow('命令 "test" 的别名 "h" 重复');
    });

    it("空字符串别名 throw", () => {
      const reg = new CommandRegistry();

      expect(() =>
        reg.register(makeCmd({ name: "test", aliases: [""] })),
      ).toThrow('命令 "test" 的别名列表包含空字符串');
    });
  });

  describe("getAll", () => {
    it("返回所有非隐藏命令", () => {
      const reg = new CommandRegistry();
      reg.register(makeCmd({ name: "cmd1" }));
      reg.register(makeCmd({ name: "cmd2" }));
      reg.register(makeCmd({ name: "cmd3", hidden: true }));

      const all = reg.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((c) => c.name).sort()).toEqual(["cmd1", "cmd2"]);
    });
  });

  describe("getMatches", () => {
    it("前缀匹配返回匹配的命令", () => {
      const reg = new CommandRegistry();
      reg.register(makeCmd({ name: "help" }));
      reg.register(makeCmd({ name: "hello" }));
      reg.register(makeCmd({ name: "clear" }));

      const matches = reg.getMatches("hel");
      expect(matches).toHaveLength(2);
      expect(matches.map((c) => c.name).sort()).toEqual(["hello", "help"]);
    });

    it("通过别名前缀匹配", () => {
      const reg = new CommandRegistry();
      reg.register(makeCmd({ name: "plan", aliases: ["p"] }));
      reg.register(makeCmd({ name: "permission", aliases: ["perm"] }));

      const matches = reg.getMatches("p");
      expect(matches).toHaveLength(2);
      expect(matches.map((c) => c.name).sort()).toEqual([
        "permission",
        "plan",
      ]);
    });

    it("单匹配", () => {
      const reg = new CommandRegistry();
      reg.register(makeCmd({ name: "help" }));
      reg.register(makeCmd({ name: "clear" }));

      const matches = reg.getMatches("cle");
      expect(matches).toHaveLength(1);
      expect(matches[0].name).toBe("clear");
    });

    it("无匹配返回空数组", () => {
      const reg = new CommandRegistry();
      reg.register(makeCmd({ name: "help" }));

      const matches = reg.getMatches("xyz");
      expect(matches).toHaveLength(0);
    });

    it("隐藏命令不参与匹配", () => {
      const reg = new CommandRegistry();
      reg.register(makeCmd({ name: "help" }));
      reg.register(makeCmd({ name: "hidden_cmd", hidden: true }));

      const matches = reg.getMatches("h");
      expect(matches).toHaveLength(1);
      expect(matches[0].name).toBe("help");
    });

    it("大小写不敏感匹配", () => {
      const reg = new CommandRegistry();
      reg.register(makeCmd({ name: "Help" }));

      const matches = reg.getMatches("hel");
      expect(matches).toHaveLength(1);
      expect(matches[0].name).toBe("Help");
    });
  });
});
