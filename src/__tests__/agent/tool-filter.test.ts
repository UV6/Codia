import { describe, it, expect } from "vitest";
import {
  ToolFilterPipeline,
  Layer1GlobalBlock,
  Layer2CustomDisallow,
  Layer3BackgroundAllow,
  Layer4RoleFilter,
} from "../../agent/tool-filter.js";
import type { Tool, ToolMeta } from "../../tool/types.js";
import type { AgentRole } from "../../agent/role/types.js";

// 构造测试用的 Tool 数组
function makeTools(names: string[]): Tool[] {
  return names.map((name) => ({
    name,
    description: `工具 ${name}`,
    type: "file" as const,
    readOnly: name !== "run_command",
    destructive: name === "run_command",
    inputSchema: { type: "object" as const, properties: {} },
    execute: async () => ({ status: "success" as const, content: "ok" }),
  }));
}

function getNames(tools: Tool[]): string[] {
  return tools.map((t) => t.name);
}

function getMetaNames(metas: ToolMeta[]): string[] {
  return metas.map((m) => m.name);
}

describe("Layer1GlobalBlock", () => {
  it("剔除 Agent、AskUserQuestion、TaskStop", () => {
    const tools = makeTools(["read_file", "Agent", "glob", "AskUserQuestion", "grep", "TaskStop"]);
    const result = Layer1GlobalBlock(tools);
    expect(getNames(result)).toEqual(["read_file", "glob", "grep"]);
  });

  it("无禁止工具时原样返回", () => {
    const tools = makeTools(["read_file", "glob", "grep"]);
    const result = Layer1GlobalBlock(tools);
    expect(getNames(result)).toEqual(["read_file", "glob", "grep"]);
  });
});

describe("Layer2CustomDisallow", () => {
  it("按自定义黑名单剔除", () => {
    const tools = makeTools(["read_file", "grep", "glob", "run_command"]);
    const result = Layer2CustomDisallow(tools, ["grep", "run_command"]);
    expect(getNames(result)).toEqual(["read_file", "glob"]);
  });

  it("customDisallowed 为空时原样返回", () => {
    const tools = makeTools(["read_file", "glob"]);
    const result1 = Layer2CustomDisallow(tools);
    const result2 = Layer2CustomDisallow(tools, []);
    expect(getNames(result1)).toEqual(["read_file", "glob"]);
    expect(getNames(result2)).toEqual(["read_file", "glob"]);
  });
});

describe("Layer3BackgroundAllow", () => {
  it("非后台模式原样返回", () => {
    const tools = makeTools(["read_file", "glob", "run_command"]);
    const result = Layer3BackgroundAllow(tools, false);
    expect(getNames(result)).toEqual(["read_file", "glob", "run_command"]);
  });

  it("后台模式仅允许白名单工具", () => {
    const tools = makeTools(["read_file", "glob", "grep", "run_command", "write_file"]);
    const result = Layer3BackgroundAllow(tools, true);
    expect(getNames(result)).toEqual(["read_file", "glob", "grep"]);
  });
});

describe("Layer4RoleFilter", () => {
  const baseTools = makeTools(["read_file", "glob", "grep", "run_command", "write_file"]);

  it("Fork 式跳过角色过滤", () => {
    const role: AgentRole = {
      source: "builtin",
      frontmatter: { name: "test", description: "test", tools: ["read_file"] },
      body: "test",
    };
    const result = Layer4RoleFilter(baseTools, role, "fork");
    expect(getNames(result)).toEqual(["read_file", "glob", "grep", "run_command", "write_file"]);
  });

  it("定义式白名单过滤", () => {
    const role: AgentRole = {
      source: "builtin",
      frontmatter: { name: "test", description: "test", tools: ["read_file", "grep"] },
      body: "test",
    };
    const result = Layer4RoleFilter(baseTools, role, "definition");
    expect(getNames(result)).toEqual(["read_file", "grep"]);
  });

  it("定义式黑名单在白名单基础上剔除", () => {
    const role: AgentRole = {
      source: "builtin",
      frontmatter: { name: "test", description: "test", tools: ["read_file", "grep", "glob"], disallowedTools: ["grep"] },
      body: "test",
    };
    const result = Layer4RoleFilter(baseTools, role, "definition");
    expect(getNames(result)).toEqual(["read_file", "glob"]);
  });

  it("无角色时原样返回", () => {
    const result = Layer4RoleFilter(baseTools, null, "definition");
    expect(getNames(result)).toEqual(["read_file", "glob", "grep", "run_command", "write_file"]);
  });
});

describe("ToolFilterPipeline.apply", () => {
  const allTools = makeTools([
    "read_file", "glob", "grep", "run_command", "write_file",
    "Agent", "TaskList", "TaskGet",
  ]);

  it("定义式前台：全局禁止 + 角色白名单", () => {
    const role: AgentRole = {
      source: "builtin",
      frontmatter: { name: "reader", description: "reader", tools: ["read_file", "glob", "grep"] },
      body: "reader",
    };
    const metas = ToolFilterPipeline.apply(allTools, role, false, "definition");
    // 第一层剔除 Agent、TaskList 没有 TaskStop/AskUserQuestion
    // Wait, Agent is in the list, so it's filtered. TaskList and TaskGet are not in GLOBAL_BLOCKED_TOOLS
    // After Layer1: read_file, glob, grep, run_command, write_file, TaskList, TaskGet
    // Layer4: role tools = ["read_file", "glob", "grep"]
    // Final: read_file, glob, grep
    expect(getMetaNames(metas)).toEqual(["read_file", "glob", "grep"]);
  });

  it("Fork 式后台：全局禁止 + 后台白名单", () => {
    const metas = ToolFilterPipeline.apply(allTools, null, true, "fork");
    // Layer1: read_file, glob, grep, run_command, write_file, TaskList, TaskGet
    // Layer2: no custom disallowed
    // Layer3: background whitelist = read_file, glob, grep
    // Layer4: skipped (fork)
    expect(getMetaNames(metas)).toEqual(["read_file", "glob", "grep"]);
  });

  it("自定义额外禁止生效", () => {
    const metas = ToolFilterPipeline.apply(allTools, null, false, "fork", ["grep"]);
    // Layer1: read_file, glob, grep, run_command, write_file, TaskList, TaskGet
    // Layer2: custom disallow grep → read_file, glob, run_command, write_file, TaskList, TaskGet
    expect(getMetaNames(metas)).toContain("read_file");
    expect(getMetaNames(metas)).not.toContain("grep");
    expect(getMetaNames(metas)).not.toContain("Agent");
  });
});
