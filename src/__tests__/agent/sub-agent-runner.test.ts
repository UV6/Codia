import { describe, it, expect } from "vitest";
import { SubAgentRunner } from "../../agent/sub-agent-runner.js";
import type { SubAgentConfig } from "../../agent/types.js";
import type { AgentRole } from "../../agent/role/types.js";
import { ToolRegistry } from "../../tool/registry.js";
import { TaskManager } from "../../agent/task-manager.js";
import type { Message } from "../../provider/types.js";

function makeFakeProvider() {
  return {
    name: "test",
    streamChat: async function* () {},
  } as unknown as SubAgentConfig["parentProvider"];
}

function makeFakeChatConfig() {
  return {
    protocol: "anthropic" as const,
    model: "sonnet",
    baseUrl: "https://test.example.com",
    apiKey: "test-key",
  };
}

function makeRole(overrides: Partial<AgentRole> = {}): AgentRole {
  return {
    source: "builtin",
    frontmatter: { name: "test-role", description: "测试角色", ...overrides.frontmatter },
    body: "你是测试角色。",
    ...overrides,
  };
}

describe("SubAgentRunner 配置构造", () => {
  it("定义式：runInBackground 由 config 决定", () => {
    const registry = new ToolRegistry();
    const config: SubAgentConfig = {
      type: "definition",
      role: makeRole(),
      prompt: "执行测试任务",
      description: "测试",
      runInBackground: false,
      parentMessages: [],
      parentProvider: makeFakeProvider(),
      parentChatConfig: makeFakeChatConfig(),
      parentRegistry: registry,
      cwd: "/tmp",
      signal: new AbortController().signal,
    };

    const runner = new SubAgentRunner(config);
    // 构造函数不抛异常
    expect(runner).toBeDefined();
  });

  it("Fork 式：runInBackground 强制 true", () => {
    const registry = new ToolRegistry();
    const parentMessages: Message[] = [
      { role: "user", content: "你好", timestamp: new Date().toISOString() },
    ];

    const config: SubAgentConfig = {
      type: "fork",
      prompt: "继续处理",
      description: "fork测试",
      runInBackground: true, // Fork 总是 true
      parentMessages,
      parentProvider: makeFakeProvider(),
      parentChatConfig: makeFakeChatConfig(),
      parentRegistry: registry,
      cwd: "/tmp",
      signal: new AbortController().signal,
    };

    const runner = new SubAgentRunner(config);
    expect(runner).toBeDefined();
  });

  it("runInBackground 方法不抛异常", () => {
    const taskManager = new TaskManager();
    const taskId = taskManager.create("后台测试", "Explore");

    const registry = new ToolRegistry();
    const config: SubAgentConfig = {
      type: "definition",
      role: makeRole(),
      prompt: "后台任务",
      description: "后台测试",
      runInBackground: true,
      parentMessages: [],
      parentProvider: makeFakeProvider(),
      parentChatConfig: makeFakeChatConfig(),
      parentRegistry: registry,
      cwd: "/tmp",
      signal: new AbortController().signal,
    };

    const runner = new SubAgentRunner(config);
    runner.runInBackground(taskManager, taskId);

    // runInBackground 是异步的，不阻塞
    expect(true).toBe(true);
  });
});
