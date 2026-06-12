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
import { execSync } from "node:child_process";

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

  // 提示词管线：基础模块 + 环境信息合并为完整 system prompt
  private fullSystemPrompt: string;

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

    // 构建完整 System Prompt：七个固定模块 + 环境信息
    const builder = new SystemPromptBuilder();
    builder.add(identitySection());
    builder.add(constraintsSection());
    builder.add(taskModeSection());
    builder.add(actionSection());
    builder.add(toolUseSection());
    builder.add(toneSection());
    builder.add(outputSection());
    const basePrompt = builder.build();
    const envInfo = this.buildEnvInfo();
    this.fullSystemPrompt = envInfo ? `${basePrompt}\n\n${envInfo}` : basePrompt;
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
        return;
      }
      return;
    }

    // 用户消息（干净，不含环境信息）
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

    // 本轮 system prompt（完整 prompt + 可选的 plan mode 后缀）
    const systemPrompt = this.mode === "plan"
      ? this.fullSystemPrompt + "\n\n" + PLAN_MODE_PROMPT + "plan.md"
      : this.fullSystemPrompt;

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
      yield event;

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

  // buildEnvInfo —— 收集系统环境，返回纯文本
  // 注意：不包含 git status/log，避免模型误读文件列表当答案
  private buildEnvInfo(): string {
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
    } catch {
      // 非 git 仓库或 git 不可用，跳过
    }

    return info.join("\n");
  }
}
