import { describe, it, expect } from "vitest";
import {
  isPlanCommand,
  isDoCommand,
  extractPlanMessage,
  filterReadOnlyTools,
  PLAN_MODE_PROMPT,
} from "../../agent/plan-mode.js";
import type { Tool, ToolInputSchema } from "../../tool/types.js";

function makeTool(overrides: Partial<Tool>): Tool {
  const schema: ToolInputSchema = { type: "object", properties: {} };
  return {
    name: "test",
    description: "a test tool",
    type: "file",
    readOnly: false,
    destructive: false,
    inputSchema: schema,
    execute: async () => ({ status: "success", content: "" }),
    ...overrides,
  };
}

describe("Plan Mode", () => {
  describe("isPlanCommand", () => {
    it("/plan 开头 → true", () => {
      expect(isPlanCommand("/plan 重构认证模块")).toBe(true);
    });

    it("/plan 不带参数 → true", () => {
      expect(isPlanCommand("/plan")).toBe(true);
    });

    it("普通消息 → false", () => {
      expect(isPlanCommand("帮我写个计划")).toBe(false);
    });

    it("中间含 /plan 不是命令 → false", () => {
      expect(isPlanCommand("帮我用 /plan 模式")).toBe(false); // 不是以 /plan 开头
    });

    it("/plan 后接其他内容 → true", () => {
      expect(isPlanCommand("/plans")).toBe(false); // /plans ≠ /plan
    });
  });

  describe("isDoCommand", () => {
    it("/do → true", () => {
      expect(isDoCommand("/do")).toBe(true);
    });

    it("/do 后带空格 → true", () => {
      expect(isDoCommand("/do ")).toBe(true);
    });

    it("/do 后带参数 → false", () => {
      expect(isDoCommand("/do something")).toBe(false);
    });
  });

  describe("extractPlanMessage", () => {
    it("提取 /plan 后的内容", () => {
      expect(extractPlanMessage("/plan 重构认证模块")).toBe("重构认证模块");
    });

    it("仅有 /plan → 空字符串", () => {
      expect(extractPlanMessage("/plan")).toBe("");
    });
  });

  describe("filterReadOnlyTools", () => {
    it("只返回 readOnly=true 的工具", () => {
      const tools: Tool[] = [
        makeTool({ name: "read_file", readOnly: true }),
        makeTool({ name: "write_file", readOnly: false, destructive: true }),
        makeTool({ name: "grep", readOnly: true }),
        makeTool({ name: "run_command", readOnly: false, destructive: false }),
      ];

      const result = filterReadOnlyTools(tools);
      expect(result).toHaveLength(2);
      expect(result.map((t) => t.name)).toEqual(["read_file", "grep"]);
    });

    it("空列表 → 返回空数组", () => {
      expect(filterReadOnlyTools([])).toEqual([]);
    });
  });

  describe("PLAN_MODE_PROMPT", () => {
    it("包含关键约束词", () => {
      expect(PLAN_MODE_PROMPT).toContain("Plan Mode");
      expect(PLAN_MODE_PROMPT).toContain("不能执行任何修改操作");
      expect(PLAN_MODE_PROMPT).toContain("plan file");
    });
  });
});
