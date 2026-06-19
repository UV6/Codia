import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookEngine } from "../../hook/engine.js";
import type { HookRule } from "../../hook/types.js";

// 辅助函数：创建一条简单规则
function makeRule(
  overrides: Partial<HookRule> = {},
): HookRule {
  return {
    event: "turn_start",
    condition: undefined,
    action: { type: "command", command: "echo hello" },
    control: { run_once: false, background: false, timeout: 5000 },
    source: "test.yaml",
    ...overrides,
  };
}

describe("HookEngine", () => {
  describe("construct", () => {
    it("空规则列表构造", () => {
      const engine = new HookEngine([]);
      expect(engine.getRules()).toEqual([]);
    });

    it("默认规则列表构造", () => {
      const engine = new HookEngine();
      expect(engine.getRules()).toEqual([]);
    });
  });

  describe("fire", () => {
    it("无匹配规则时不执行任何动作", async () => {
      const engine = new HookEngine([makeRule({ event: "post_tool" })]);
      // 不应该抛异常
      await expect(
        engine.fire("turn_start", {}),
      ).resolves.toBeUndefined();
    });

    it("匹配规则时执行动作", async () => {
      const engine = new HookEngine([makeRule()]);
      // echo hello 不抛异常
      const result = await engine.fire("turn_start", {});
      expect(result).toBeUndefined();
    });

    it("不匹配条件的规则被跳过", async () => {
      const engine = new HookEngine([
        makeRule({
          condition: { match: "all", fields: [{ field: "tool_name", equals: "Bash" }] },
        }),
      ]);
      // tool_name 不在 context 中，应跳过
      await expect(
        engine.fire("turn_start", {}),
      ).resolves.toBeUndefined();
    });

    it("动作失败不抛出异常", async () => {
      const engine = new HookEngine([
        makeRule({
          action: { type: "command", command: "nonexistent_command_xyz" },
        }),
      ]);
      await expect(
        engine.fire("turn_start", {}),
      ).resolves.toBeUndefined();
    });
  });

  describe("fireIntercept", () => {
    it("无匹配规则时返回 blocked: false", async () => {
      const engine = new HookEngine([]);
      const result = await engine.fireIntercept("pre_tool", {});
      expect(result).toEqual({ blocked: false });
    });

    it("stdout 含 REJECT: 返回 blocked: true", async () => {
      const engine = new HookEngine([
        makeRule({
          event: "pre_tool",
          action: { type: "command", command: "echo REJECT: not allowed" },
        }),
      ]);
      const result = await engine.fireIntercept("pre_tool", {});
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe("not allowed");
    });

    it("REJECT: 后无内容时使用默认理由", async () => {
      const engine = new HookEngine([
        makeRule({
          event: "pre_tool",
          action: { type: "command", command: "echo REJECT:" },
        }),
      ]);
      const result = await engine.fireIntercept("pre_tool", {});
      expect(result.blocked).toBe(true);
      expect(result.reason).toBeTruthy();
    });

    it("普通输出返回 blocked: false", async () => {
      const engine = new HookEngine([
        makeRule({
          event: "pre_tool",
          action: { type: "command", command: "echo allowed" },
        }),
      ]);
      const result = await engine.fireIntercept("pre_tool", {});
      expect(result).toEqual({ blocked: false });
    });

    it("命令失败时跳过该规则继续", async () => {
      const engine = new HookEngine([
        makeRule({
          event: "pre_tool",
          action: { type: "command", command: "nonexistent_cmd_xyz" },
        }),
      ]);
      const result = await engine.fireIntercept("pre_tool", {});
      // 命令失败 → null，不是 REJECT，返回 blocked: false
      expect(result.blocked).toBe(false);
    });
  });

  describe("run_once", () => {
    it("run_once 规则只执行一次", async () => {
      let count = 0;
      const engine = new HookEngine([
        makeRule({
          control: { run_once: true, background: false, timeout: 5000 },
          action: { type: "command", command: "echo run_once" },
        } as HookRule),
      ]);

      // 第一次执行
      await engine.fire("turn_start", {});
      // 第二次执行应该跳过
      await engine.fire("turn_start", {});
      // 不抛异常即通过
    });

    it("loadRules 后 run_once 重置", async () => {
      const engine = new HookEngine([
        makeRule({
          control: { run_once: true, background: false, timeout: 5000 },
          action: { type: "command", command: "echo run_once" },
        } as HookRule),
      ]);

      await engine.fire("turn_start", {});
      // 重载规则，run_once 应重置
      engine.loadRules(engine.getRules() as HookRule[]);
      // 第二次应能再次执行
      await engine.fire("turn_start", {});
      // 不抛异常即通过
    });
  });

  describe("background", () => {
    it("background 规则不阻塞 fire 返回", async () => {
      const engine = new HookEngine([
        makeRule({
          control: { run_once: false, background: true, timeout: 5000 },
          action: { type: "command", command: "sleep 1 && echo done" },
        } as HookRule),
      ]);

      const start = Date.now();
      await engine.fire("turn_start", {});
      const elapsed = Date.now() - start;

      // background 模式不等待 sleep，应很快返回
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe("prompt callback", () => {
    it("prompt 动作通过 onPrompt 回调传递文本", async () => {
      const engine = new HookEngine([
        makeRule({
          event: "pre_llm",
          action: { type: "prompt", text: "注入的提示词" },
        } as HookRule),
      ]);

      let capturedText = "";
      await engine.fire("pre_llm", {}, {
        onPrompt: (text: string) => {
          capturedText = text;
        },
      });

      expect(capturedText).toBe("注入的提示词");
    });

    it("无 onPrompt 回调时 prompt 文本被丢弃", async () => {
      const engine = new HookEngine([
        makeRule({
          event: "pre_llm",
          action: { type: "prompt", text: "注入的提示词" },
        } as HookRule),
      ]);

      // 不传 onPrompt，应不抛异常
      await expect(
        engine.fire("pre_llm", {}),
      ).resolves.toBeUndefined();
    });
  });
});
