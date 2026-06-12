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
  PLAN_MODE_PROMPT,
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
import { wrapReminder } from "../prompt/reminders.js";
import type { SystemReminder } from "../prompt/types.js";
import { execSync } from "node:child_process";

// PLAN_MODE_TAG —— plan mode 活跃时的简短标签
const PLAN_MODE_TAG = "Plan Mode 已激活，plan file: plan.md";

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
  private baseSystemPrompt: string;
  private envReminderInjected: boolean = false;

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

    // 构建稳定的基础 System Prompt（七个固定模块，缓存友好）
    const builder = new SystemPromptBuilder();
    builder.add(identitySection());
    builder.add(constraintsSection());
    builder.add(taskModeSection());
    builder.add(actionSection());
    builder.add(toolUseSection());
    builder.add(toneSection());
    builder.add(outputSection());
    this.baseSystemPrompt = builder.build();
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
    } else if (isDoCommand(text)) {
      if (this.mode === "plan") {
        this.mode = "full";
        return; // /do 本身不产生对话
      }
      return;
    }

    // 注入环境信息 reminder（仅首条消息前注入一次）
    // 通过前缀形式合并到用户消息中，避免产生连续 user 消息违反 API 交替规则
    let envReminderPrefix = "";
    if (!this.envReminderInjected) {
      this.envReminderInjected = true;
      const envReminder = this.buildEnvReminder();
      if (envReminder) {
        envReminderPrefix = wrapReminder(envReminder) + "\n\n";
      }
    }

    // 用户消息（reminder + 用户输入合并为一条消息）
    const userMsg: Message = {
      role: "user",
      content: envReminderPrefix + text,
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

    // 构建本轮 system prompt（基础模块 + 可选的 plan mode 后缀）
    const systemPrompt = this.mode === "plan"
      ? this.baseSystemPrompt + "\n\n" + PLAN_MODE_PROMPT + "plan.md"
      : this.baseSystemPrompt;

    // 启动 AgentLoop
    for await (const event of this.agentLoop.run(
      this.messages,
      this.provider,
      this.config,
      agentConfig,
      signal,
      process.cwd(),
      systemPrompt,
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

  // buildEnvReminder —— 收集系统环境和 Git 上下文
  private buildEnvReminder(): SystemReminder | null {
    const info: string[] = [];
    info.push(`操作系统: ${process.platform}`);
    info.push(`Shell: ${process.env.SHELL || "unknown"}`);
    info.push(`日期: ${new Date().toISOString().split("T")[0]}`);
    info.push(`工作目录: ${process.cwd()}`);

    try {
      const gitBranch = execSync("git branch --show-current", {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      if (gitBranch) {
        info.push(`Git 分支: ${gitBranch}`);
      }

      const gitLog = execSync("git log --oneline -3", {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      if (gitLog) {
        info.push(`最近提交:\n${gitLog}`);
      }

      const gitStatus = execSync("git status --short", {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      if (gitStatus) {
        info.push(`未提交变更:\n${gitStatus}`);
      }
    } catch {
      // 非 git 仓库或 git 不可用，跳过
    }

    return {
      source: "env-info",
      content: info.join("\n"),
      round: 0,
    };
  }
}
