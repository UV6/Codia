import type { Message } from "../provider/types.js";
import { ToolRegistry } from "../tool/registry.js";
import { AgentLoop } from "./loop.js";
import { ToolFilterPipeline } from "./tool-filter.js";
import { PermissionChecker } from "../permission/checker.js";
import { RuleEngine } from "../permission/rule-engine.js";
import type { AgentLoopConfig, SubAgentConfig, SubAgentResult } from "./types.js";
import type { ToolMeta } from "../tool/types.js";
import type { TaskManager } from "./task-manager.js";

// SubAgentRunner —— 子 Agent 运行器，构造隔离环境并驱动 AgentLoop
export class SubAgentRunner {
  private config: SubAgentConfig;

  constructor(config: SubAgentConfig) {
    this.config = config;
  }

  // run —— 执行子 Agent 并返回结果
  async run(): Promise<SubAgentResult> {
    const { config } = this;

    // 1. 构造消息
    const messages: Message[] = config.type === "definition"
      ? [{ role: "user", content: config.prompt, timestamp: new Date().toISOString() }]
      : [...config.parentMessages, { role: "user", content: config.prompt, timestamp: new Date().toISOString() }];

    // 2. 构造系统提示
    const systemPrompt = config.type === "definition" && config.role
      ? config.role.body
      : undefined;

    // 3. 工具过滤
    const customDisallowed = process.env.CUSTOM_AGENT_DISALLOWED_TOOLS
      ? process.env.CUSTOM_AGENT_DISALLOWED_TOOLS.split(",").map((s) => s.trim())
      : undefined;

    const filteredMetas: ToolMeta[] = ToolFilterPipeline.apply(
      config.parentRegistry.getAll(),
      config.role ?? null,
      config.runInBackground,
      config.type,
      customDisallowed,
    );

    // 4. 创建独立工具注册中心并注册过滤后的工具
    const toolRegistry = new ToolRegistry();
    const allTools = config.parentRegistry.getAll();
    const filteredNames = new Set(filteredMetas.map((m) => m.name));
    for (const tool of allTools) {
      if (filteredNames.has(tool.name)) {
        toolRegistry.register(tool);
      }
    }

    // 5. 创建独立的权限检查器
    const permissionMode = config.role?.frontmatter.permissionMode ?? "bypassPermissions";
    const ruleEngine = new RuleEngine();
    // 子 Agent 不需要加载规则文件，权限由角色决定
    const permissionChecker = new PermissionChecker(
      ruleEngine,
      permissionMode,
      async () => "yes", // 静默放行
    );

    // 6. 构造 AgentLoop 配置
    const maxRounds = config.role?.frontmatter.maxRounds ?? 20;
    const agentConfig: AgentLoopConfig = {
      maxRounds,
      mode: "full",
      allowedTools: filteredMetas.map((m) => m.name),
    };

    // 7. 创建 AgentLoop 实例（复用父 HookEngine）
    const agentLoop = new AgentLoop(
      toolRegistry,
      undefined, // 子 Agent 不需要上下文压缩
      config.parentHookEngine,
    );

    // 覆盖 model（如有指定）
    const chatConfig = { ...config.parentChatConfig };
    if (config.model) {
      chatConfig.model = config.model;
    } else if (config.role?.frontmatter.model && config.role.frontmatter.model !== "inherit") {
      chatConfig.model = config.role.frontmatter.model;
    }

    // 8. 执行 AgentLoop
    let finalText = "";
    let usage = { inputTokens: 0, outputTokens: 0, model: chatConfig.model };
    let rounds = 0;
    let toolCalls = 0;
    let finalStatus: SubAgentResult["status"] = "completed";

    try {
      for await (const event of agentLoop.run(
        messages,
        config.parentProvider,
        chatConfig,
        agentConfig,
        config.signal,
        config.cwd,
        systemPrompt,
        permissionChecker,
      )) {
        if (event.type === "text") {
          finalText += event.content;
        }
        if (event.type === "usage") {
          usage = event.usage;
        }
        if (event.type === "tool_execution_start") {
          toolCalls++;
        }
        if (event.type === "round_end") {
          rounds = event.round;
        }
        if (event.type === "stopped") {
          if (event.reason === "max_rounds") {
            finalStatus = "max_rounds";
            if (!finalText) {
              finalText = "已达最大轮次限制，任务未完全完成。";
            }
          } else if (event.reason === "cancelled") {
            finalStatus = "cancelled";
          } else if (event.reason === "stream_error") {
            finalStatus = "failed";
          }
        }
      }
    } catch (e) {
      return {
        status: "failed",
        text: `子 Agent 执行异常：${(e as Error).message}`,
        usage,
        rounds,
        toolCalls,
      };
    }

    return {
      status: finalStatus,
      text: finalText,
      usage,
      rounds,
      toolCalls,
    };
  }

  // runInBackground —— 异步启动 run()，完成后通过 taskManager 更新状态
  runInBackground(taskManager: TaskManager, taskId: string): void {
    this.run()
      .then((result) => {
        taskManager.update(taskId, result);
      })
      .catch((e) => {
        taskManager.update(taskId, {
          status: "failed",
          text: `子 Agent 异常：${(e as Error).message}`,
          usage: { inputTokens: 0, outputTokens: 0, model: "" },
          rounds: 0,
          toolCalls: 0,
        });
      });
  }
}
