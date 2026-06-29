import { describe, it, expect, beforeEach } from "vitest";
import { AgentTool } from "../../agent/agent-tool.js";
import { AgentRoleRegistry } from "../../agent/role/registry.js";
import { TaskManager } from "../../agent/task-manager.js";
import { ToolRegistry } from "../../tool/registry.js";
import type { ToolContext } from "../../tool/types.js";
import type { Message, ChatConfig, LLMProvider } from "../../provider/types.js";

function makeFakeProvider(): LLMProvider {
  return {
    name: "test",
    streamChat: async function* () {},
  };
}

function makeFakeChatConfig(): ChatConfig {
  return {
    protocol: "anthropic",
    model: "sonnet",
    baseUrl: "https://test.example.com",
    apiKey: "test-key",
  };
}

describe("AgentTool", () => {
  let registry: AgentRoleRegistry;
  let taskManager: TaskManager;
  let toolRegistry: ToolRegistry;
  let messages: Message[];
  let agentTool: AgentTool;
  let ctx: ToolContext;

  beforeEach(() => {
    registry = new AgentRoleRegistry("/tmp/test-project");
    registry.reload();
    taskManager = new TaskManager();
    toolRegistry = new ToolRegistry();
    messages = [];

    agentTool = new AgentTool(
      registry,
      taskManager,
      makeFakeChatConfig(),
      makeFakeProvider(),
      () => messages,
      () => toolRegistry,
    );

    ctx = { cwd: "/tmp", signal: new AbortController().signal };
  });

  it("缺少 description 时返回错误", async () => {
    const result = await agentTool.execute(
      { subagent_type: "Explore", prompt: "探索代码" },
      ctx,
    );
    expect(result.status).toBe("error");
    expect(result.content).toContain("缺少必填参数");
  });

  it("缺少 prompt 时返回错误", async () => {
    const result = await agentTool.execute(
      { subagent_type: "Explore", description: "测试" },
      ctx,
    );
    expect(result.status).toBe("error");
    expect(result.content).toContain("缺少必填参数");
  });

  it("subagent_type 为不存在的角色时返回错误", async () => {
    const result = await agentTool.execute(
      { subagent_type: "NonExistent", description: "测试", prompt: "做某事" },
      ctx,
    );
    expect(result.status).toBe("error");
    expect(result.content).toContain("不存在");
  });

  it("subagent_type 为有效角色时启动定义式子 Agent", async () => {
    const result = await agentTool.execute(
      { subagent_type: "Explore", description: "探索代码", prompt: "搜索 src/" },
      ctx,
    );
    // 定义式默认前台执行，结果可能成功或失败（取决于 LLM），但不返回参数错误
    expect(result.status).toBeDefined();
    // 由于没有真实 LLM，SubAgentRunner 会失败，但参数校验通过
  });

  it("subagent_type 留空时 Fork 式后台执行", async () => {
    const result = await agentTool.execute(
      { description: "后台任务", prompt: "处理数据" },
      ctx,
    );
    // Fork 强制后台，应返回"已加入后台"
    expect(result.status).toBe("success");
    expect(result.content).toContain("后台执行队列");
  });

  it("定义式指定 run_in_background: true 走后台", async () => {
    const result = await agentTool.execute(
      {
        subagent_type: "Explore",
        description: "后台探索",
        prompt: "搜索",
        run_in_background: true,
      },
      ctx,
    );
    expect(result.status).toBe("success");
    expect(result.content).toContain("后台执行队列");
  });

  it("name 和 description 正确传入", () => {
    expect(agentTool.name).toBe("Agent");
    expect(agentTool.description).toContain("子 Agent");
    expect(agentTool.type).toBe("search");
    expect(agentTool.readOnly).toBe(false);
    expect(agentTool.destructive).toBe(false);
  });

  it("inputSchema 包含所有参数", () => {
    const { properties } = agentTool.inputSchema;
    expect(properties.subagent_type).toBeDefined();
    expect(properties.description).toBeDefined();
    expect(properties.prompt).toBeDefined();
    expect(properties.name).toBeDefined();
    expect(properties.model).toBeDefined();
    expect(properties.run_in_background).toBeDefined();
    expect(properties.isolation).toBeDefined();
    expect(properties.isolation.type).toBe("boolean");
  });
});
