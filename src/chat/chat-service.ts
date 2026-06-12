import type { Message, ChatConfig } from "../provider/types.js";
import { createProvider } from "../provider/factory.js";
import { loadHistory, appendMessage, newSessionPath } from "./history.js";
import { ToolRegistry } from "../tool/registry.js";
import { readFileTool } from "../tool/tools/read-file.js";
import { writeFileTool } from "../tool/tools/write-file.js";
import { editFileTool } from "../tool/tools/edit-file.js";
import { globTool } from "../tool/tools/glob.js";
import { grepTool } from "../tool/tools/grep.js";
import { runCommandTool } from "../tool/tools/run-command.js";
import { AgentLoop, DEFAULT_MAX_ROUNDS } from "../agent/loop.js";
import {
  isPlanCommand,
  isDoCommand,
  extractPlanMessage,
} from "../agent/plan-mode.js";
import type { AgentEvent, AgentLoopConfig } from "../agent/types.js";
import { SystemPromptBuilder } from "../prompt/builder.js";
import {
  identitySection,
  constraintsSection,
  taskModeSection,
  actionSection,
  toolUseSection,
  toneSection,
  outputSection,
} from "../prompt/sections.js";
import {
  createEnvInfoProvider,
  PlanModeReminderProvider,
} from "../prompt/reminders.js";
import type { ReminderProvider, SystemReminder } from "../prompt/types.js";

// ChatService —— 对话核心
// 负责消息历史管理、会话持久化、命令解析，循环逻辑委托给 AgentLoop
export class ChatService {
  private provider;
  private config: ChatConfig;
  private historyPath: string;
  private messages: Message[] = [];
  private abortController: AbortController | null = null;
  private registry: ToolRegistry;
  private agentLoop: AgentLoop;
  private mode: "full" | "plan" = "full";
  private maxRounds: number;

  // 提示词管线
  private systemPrompt: string;
  private envInfoProvider: ReminderProvider;
  private planModeReminder: PlanModeReminderProvider;
  private currentRound: number = 0;

  onUsage: ((usage: { inputTokens: number; outputTokens: number; model: string }) => void) | null =
    null;

  constructor(config: ChatConfig, historyPath: string = newSessionPath(), maxRounds?: number) {
    this.config = config;
    this.historyPath = historyPath;
    this.provider = createProvider(config);
    this.messages = loadHistory(historyPath);
    this.maxRounds = maxRounds ?? DEFAULT_MAX_ROUNDS;

    // 注册六个核心工具
    this.registry = new ToolRegistry();
    this.registry.register(readFileTool);
    this.registry.register(writeFileTool);
    this.registry.register(editFileTool);
    this.registry.register(globTool);
    this.registry.register(grepTool);
    this.registry.register(runCommandTool);

    this.agentLoop = new AgentLoop(this.registry);

    // 构建稳定的 System Prompt（七个固定模块）
    const builder = new SystemPromptBuilder();
    builder.add(identitySection());
    builder.add(constraintsSection());
    builder.add(taskModeSection());
    builder.add(actionSection());
    builder.add(toolUseSection());
    builder.add(toneSection());
    builder.add(outputSection());
    this.systemPrompt = builder.build();

    // 初始化动态提醒提供者
    this.envInfoProvider = createEnvInfoProvider(process.cwd());
    this.planModeReminder = new PlanModeReminderProvider("plan.md");
  }

  get history(): Message[] {
    return [...this.messages];
  }

  // 当前模式
  get currentMode(): "full" | "plan" {
    return this.mode;
  }

  async *sendMessage(text: string): AsyncIterable<AgentEvent> {
    this.cancel();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // 解析命令
    if (isPlanCommand(text)) {
      this.mode = "plan";
      const planMessage = extractPlanMessage(text) || "请分析需求并写入执行计划";
      text = planMessage;

      // 激活 Plan Mode（通过 reminder 机制注入，不污染 system prompt）
      this.planModeReminder.activate(this.currentRound);
    } else if (isDoCommand(text)) {
      if (this.mode === "plan") {
        this.mode = "full";
        this.planModeReminder.deactivate();
        return; // /do 本身不产生对话
      }
      // 非 plan 模式下 /do 无操作
      return;
    }

    // 用户消息
    const userMsg: Message = {
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(userMsg);
    appendMessage(this.historyPath, userMsg);

    // 记录循环前的消息数量，用于后续持久化
    const prevCount = this.messages.length;

    // 构建 AgentLoop 配置
    const agentConfig: AgentLoopConfig = {
      maxRounds: this.maxRounds,
      mode: this.mode,
    };

    // 合并所有 ReminderProvider
    const combinedReminders: ReminderProvider = (round: number) => {
      this.currentRound = round;
      return [
        ...this.envInfoProvider(round),
        ...this.planModeReminder.toProvider()(round),
      ];
    };

    // 启动 AgentLoop（传入 systemPrompt 和 reminders）
    for await (const event of this.agentLoop.run(
      this.messages,
      this.provider,
      this.config,
      agentConfig,
      signal,
      process.cwd(),
      this.systemPrompt,
      combinedReminders,
    )) {
      // 转发事件给界面
      yield event;

      // Token 用量回调
      if (event.type === "usage" && this.onUsage) {
        this.onUsage(event.usage);
      }
    }

    // 持久化本轮新增的消息
    const newMessages = this.messages.slice(prevCount);
    for (const msg of newMessages) {
      appendMessage(this.historyPath, msg);
    }

    this.abortController = null;
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

}
