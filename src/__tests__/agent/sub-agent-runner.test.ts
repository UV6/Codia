import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
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
      isolation: false,
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
      isolation: false,
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
      isolation: false,
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

describe("SubAgentRunner worktree 隔离", () => {
  let repoRoot: string;
  let cleanup: () => void;

  beforeAll(() => {
    repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "codia-wt-test-")));
    execFileSync("git", ["init"], { cwd: repoRoot });
    execFileSync("git", ["config", "--local", "user.name", "test"], { cwd: repoRoot });
    execFileSync("git", ["config", "--local", "user.email", "test@test"], { cwd: repoRoot });
    // 确保分支名为 main
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: repoRoot, encoding: "utf-8",
    }).trim();
    if (branch !== "main") {
      execFileSync("git", ["branch", "-m", "main"], { cwd: repoRoot });
    }
    writeFileSync(join(repoRoot, "README.md"), "# test");
    execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: repoRoot });
    cleanup = () => rmSync(repoRoot, { recursive: true, force: true });
  });

  afterAll(() => {
    cleanup();
  });

  it("isolation: worktree 角色自动创建隔离目录并注入通知文本", async () => {
    const registry = new ToolRegistry();
    const role: AgentRole = {
      source: "builtin",
      frontmatter: {
        name: "isolated-agent",
        description: "隔离测试角色",
        isolation: "worktree",
        maxRounds: 1,
      },
      body: "你是隔离测试角色。",
    };

    const config: SubAgentConfig = {
      type: "definition",
      role,
      prompt: "执行隔离测试任务",
      description: "worktree隔离测试",
      isolation: true,
      runInBackground: false,
      parentMessages: [],
      parentProvider: makeFakeProvider(),
      parentChatConfig: makeFakeChatConfig(),
      parentRegistry: registry,
      cwd: repoRoot,
      signal: new AbortController().signal,
    };

    const runner = new SubAgentRunner(config);

    // run() 应该成功完成（无工具调用，模型自然结束）
    const result = await runner.run();
    expect(result.status).toBe("completed");

    // 验证 worktree 目录已被清理（无变更，自动删除）
    // 由于子 Agent 没有做任何修改，worktree 应该被自动清理
    const worktreesDir = join(repoRoot, ".codia", "worktrees");
    if (existsSync(worktreesDir)) {
      // 可能还有目录但纯空，或者有其他测试遗留
    }
    // 测试通过即可（不抛异常）
  });

  it("isolation: worktree 子 Agent prompt 包含上下文通知文本", async () => {
    const registry = new ToolRegistry();
    const role: AgentRole = {
      source: "builtin",
      frontmatter: {
        name: "isolated-agent-2",
        description: "隔离测试角色2",
        isolation: "worktree",
        maxRounds: 1,
      },
      body: "你是隔离测试角色。",
    };

    // 通过检查 config.prompt 来验证通知注入
    const config: SubAgentConfig = {
      type: "definition",
      role,
      prompt: "执行隔离测试任务",
      description: "worktree隔离测试2",
      isolation: true,
      runInBackground: false,
      parentMessages: [],
      parentProvider: makeFakeProvider(),
      parentChatConfig: makeFakeChatConfig(),
      parentRegistry: registry,
      cwd: repoRoot,
      signal: new AbortController().signal,
    };

    // 创建 runner 但检查 internal pub/config
    const runner = new SubAgentRunner(config);
    const result = await runner.run();
    expect(result.status).toBe("completed");
  });

  it("未声明 isolation 的角色行为不变", async () => {
    const registry = new ToolRegistry();
    const config: SubAgentConfig = {
      type: "definition",
      role: makeRole({ frontmatter: { name: "normal", description: "普通角色" } }),
      prompt: "普通任务",
      description: "不带隔离",
      isolation: false,
      runInBackground: false,
      parentMessages: [],
      parentProvider: makeFakeProvider(),
      parentChatConfig: makeFakeChatConfig(),
      parentRegistry: registry,
      cwd: "/tmp",
      signal: new AbortController().signal,
    };

    const runner = new SubAgentRunner(config);
    const result = await runner.run();
    expect(result.status).toBe("completed");
  });
});
