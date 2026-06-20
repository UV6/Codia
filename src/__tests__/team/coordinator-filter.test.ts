import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CoordinatorFilter } from "../../team/coordinator-filter.js";
import type { Tool, ToolContext, ToolResult, ToolInputSchema } from "../../tool/types.js";

// 创建模拟工具的辅助函数
function makeTool(name: string, readOnly = false): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    type: readOnly ? "search" : "shell",
    readOnly,
    destructive: false,
    inputSchema: { type: "object", properties: {} },
    execute: async (_params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => ({
      status: "success",
      content: `${name} result`,
    }),
  };
}

describe("CoordinatorFilter", () => {
  const originalEnv = process.env.CODIA_COORDINATOR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CODIA_COORDINATOR;
    } else {
      process.env.CODIA_COORDINATOR = originalEnv;
    }
  });

  describe("isEnabled", () => {
    it("两把锁都开时返回 true", () => {
      process.env.CODIA_COORDINATOR = "1";
      const config = { coordinator: { enabled: true }, agentLoop: { maxRounds: 20 } };
      expect(CoordinatorFilter.isEnabled(config)).toBe(true);
    });

    it("配置关、环境变量开 → false", () => {
      process.env.CODIA_COORDINATOR = "1";
      const config = { coordinator: { enabled: false }, agentLoop: { maxRounds: 20 } };
      expect(CoordinatorFilter.isEnabled(config)).toBe(false);
    });

    it("配置开、环境变量关 → false", () => {
      delete process.env.CODIA_COORDINATOR;
      const config = { coordinator: { enabled: true }, agentLoop: { maxRounds: 20 } };
      expect(CoordinatorFilter.isEnabled(config)).toBe(false);
    });

    it("两把锁都关 → false", () => {
      delete process.env.CODIA_COORDINATOR;
      const config = { coordinator: { enabled: false }, agentLoop: { maxRounds: 20 } };
      expect(CoordinatorFilter.isEnabled(config)).toBe(false);
    });

    it("config 为 undefined → false", () => {
      process.env.CODIA_COORDINATOR = "1";
      expect(CoordinatorFilter.isEnabled(undefined)).toBe(false);
    });
  });

  describe("apply", () => {
    it("开启后 write_file/edit_file 不在结果中", () => {
      process.env.CODIA_COORDINATOR = "1";
      const config = { coordinator: { enabled: true }, agentLoop: { maxRounds: 20 } };
      const tools = [makeTool("read_file", true), makeTool("write_file"), makeTool("edit_file"), makeTool("run_command")];
      const filtered = CoordinatorFilter.apply(tools, config);
      const names = filtered.map((t) => t.name);
      expect(names).toContain("read_file");
      expect(names).toContain("run_command");
      expect(names).not.toContain("write_file");
      expect(names).not.toContain("edit_file");
    });

    it("开启后 Agent 在结果中", () => {
      process.env.CODIA_COORDINATOR = "1";
      const config = { coordinator: { enabled: true }, agentLoop: { maxRounds: 20 } };
      const tools = [makeTool("Agent"), makeTool("write_file")];
      const filtered = CoordinatorFilter.apply(tools, config);
      expect(filtered.map((t) => t.name)).toContain("Agent");
    });

    it("关闭后所有工具原样返回", () => {
      delete process.env.CODIA_COORDINATOR;
      const config = { coordinator: { enabled: true }, agentLoop: { maxRounds: 20 } };
      const tools = [makeTool("write_file"), makeTool("read_file")];
      const filtered = CoordinatorFilter.apply(tools, config);
      expect(filtered.length).toBe(2);
    });

    it("MCP 工具默认放行", () => {
      process.env.CODIA_COORDINATOR = "1";
      const config = { coordinator: { enabled: true }, agentLoop: { maxRounds: 20 } };
      const tools = [makeTool("mcp__playwright__browser_navigate"), makeTool("write_file")];
      const filtered = CoordinatorFilter.apply(tools, config);
      expect(filtered.map((t) => t.name)).toContain("mcp__playwright__browser_navigate");
    });
  });

  describe("getAllowedTools", () => {
    it("返回白名单数组", () => {
      const tools = CoordinatorFilter.getAllowedTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools).toContain("read_file");
      expect(tools).toContain("Agent");
    });
  });
});
