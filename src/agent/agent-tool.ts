import type { Message, ChatConfig, LLMProvider } from "../provider/types.js";
import type { Tool, ToolContext, ToolResult, ToolInputSchema } from "../tool/types.js";
import type { HookEngine } from "../hook/engine.js";
import type { ToolRegistry } from "../tool/registry.js";
import type { AgentRoleRegistry } from "./role/registry.js";
import type { TaskManager } from "./task-manager.js";
import { SubAgentRunner } from "./sub-agent-runner.js";
import type { SubAgentConfig } from "./types.js";

// AgentTool —— 统一的 Agent 工具，用 subagent_type 分流定义式/Fork 式
export class AgentTool implements Tool {
  readonly name = "Agent";
  readonly description =
    "启动子 Agent 执行任务。定义式：指定 subagent_type 角色名从空白对话启动；Fork 式：留空 subagent_type 继承父对话历史";
  readonly type = "search" as const;
  readonly readOnly = false;
  readonly destructive = false;

  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      subagent_type: {
        type: "string",
        description:
          '角色名（如 "Explore"、"Plan"、"code-reviewer"），留空则为 Fork 式继承父对话',
      },
      description: {
        type: "string",
        description: "简短描述（3-5 词），用于进度展示",
      },
      prompt: {
        type: "string",
        description: "委派给子 Agent 的任务描述",
      },
      name: {
        type: "string",
        description: "可选的显示名称",
      },
      model: {
        type: "string",
        description: "可选模型覆盖",
      },
      run_in_background: {
        type: "boolean",
        description: "是否显式后台运行",
      },
      isolation: {
        type: "boolean",
        description:
          "是否启用 git worktree 文件系统隔离。默认遵循角色配置，显式传入则覆盖角色默认值",
      },
    },
    required: ["description", "prompt"],
  };

  private registry: AgentRoleRegistry;
  private taskManager: TaskManager;
  private chatConfig: ChatConfig;
  private provider: LLMProvider;
  private hookEngine?: HookEngine;
  private getParentMessages: () => Message[];
  private getParentRegistry: () => ToolRegistry;

  constructor(
    registry: AgentRoleRegistry,
    taskManager: TaskManager,
    chatConfig: ChatConfig,
    provider: LLMProvider,
    getParentMessages: () => Message[],
    getParentRegistry: () => ToolRegistry,
    hookEngine?: HookEngine,
  ) {
    this.registry = registry;
    this.taskManager = taskManager;
    this.chatConfig = chatConfig;
    this.provider = provider;
    this.getParentMessages = getParentMessages;
    this.getParentRegistry = getParentRegistry;
    this.hookEngine = hookEngine;
  }

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const description = params.description as string;
    const prompt = params.prompt as string;

    if (!description || !prompt) {
      return {
        status: "error",
        content: "缺少必填参数 description 和/或 prompt",
      };
    }

    const subagentType = params.subagent_type as string | undefined;
    const displayName = params.name as string | undefined;
    const model = params.model as string | undefined;
    const runInBackground = params.run_in_background === true;

    // isolation 优先级：工具调用参数 > 角色 frontmatter > false
    const role = subagentType ? this.registry.resolve(subagentType) : undefined;
    if (subagentType && !role) {
      return {
        status: "error",
        content: `角色 "${subagentType}" 不存在。可用角色：${this.registry
          .list()
          .map((r) => r.frontmatter.name)
          .join(", ")}`,
      };
    }
    const isolation =
      typeof params.isolation === "boolean"
        ? params.isolation
        : role?.frontmatter.isolation === "worktree";

    // 解析类型：有 subagent_type → 定义式，留空 → Fork 式
    if (subagentType) {
      // 定义式
      const subAgentConfig: SubAgentConfig = {
        type: "definition",
        role: role!,
        prompt,
        description,
        name: displayName ?? role!.frontmatter.name,
        model,
        isolation,
        runInBackground: false, // 定义式默认前台，除非显式指定
        parentMessages: [],
        parentProvider: this.provider,
        parentChatConfig: this.chatConfig,
        parentRegistry: this.getParentRegistry(),
        parentHookEngine: this.hookEngine,
        cwd: context.cwd,
        signal: context.signal,
      };

      return this.runAgent(subAgentConfig, runInBackground);
    }

    // Fork 式
    const subAgentConfig: SubAgentConfig = {
      type: "fork",
      prompt,
      description,
      name: displayName ?? "fork",
      model,
      isolation,
      runInBackground: true, // Fork 强制后台
      parentMessages: this.getParentMessages(),
      parentProvider: this.provider,
      parentChatConfig: this.chatConfig,
      parentRegistry: this.getParentRegistry(),
      parentHookEngine: this.hookEngine,
      cwd: context.cwd,
      signal: context.signal,
    };

    return this.runAgent(subAgentConfig, true); // Fork 强制后台
  }

  private async runAgent(
    config: SubAgentConfig,
    runInBackground: boolean,
  ): Promise<ToolResult> {
    const runner = new SubAgentRunner(config);

    if (runInBackground) {
      // 后台执行
      const taskId = this.taskManager.create(config.description, config.type);
      runner.runInBackground(this.taskManager, taskId);

      return {
        status: "success",
        content: `子 Agent 已加入后台执行队列，任务 ID: ${taskId}。可通过 TaskList 查询状态。`,
      };
    }

    // 前台执行
    try {
      const result = await runner.run();

      if (result.status === "failed" || result.status === "cancelled") {
        return {
          status: "error",
          content: result.text || `子 Agent 执行失败（${result.status}）`,
        };
      }

      return {
        status: "success",
        content: result.text,
      };
    } catch (e) {
      return {
        status: "error",
        content: `子 Agent 执行异常：${(e as Error).message}`,
      };
    }
  }
}
