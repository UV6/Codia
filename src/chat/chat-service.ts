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
import { ContextManager } from "../context/manager.js";
import { SystemPromptBuilder } from "../prompt/builder.js";
import {
  identitySection,
  constraintsSection,
  taskModeSection,
  actionSection,
  toolUseSection,
  toneSection,
  outputSection,
  instructionSection,
  memorySection,
} from "../prompt/sections.js";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import type { PermissionMode, HumanInTheLoopCallback } from "../permission/types.js";
import { RuleEngine } from "../permission/rule-engine.js";
import { PermissionChecker } from "../permission/checker.js";
import { ConnectionManager } from "../mcp/manager.js";
import { loadMcpConfig } from "../mcp/config.js";
import { buildNewSessionContext, buildResumeContext } from "../bootstrap/context-builder.js";
import type { BootstrapContext } from "../bootstrap/types.js";
import { extractFromTurn } from "../memory/extractor.js";
import type { MemoryIndexBundle } from "../memory/types.js";
import { loadIndexes } from "../memory/store.js";

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

  // 权限系统配置
  private permissionMode: PermissionMode;
  private humanInTheLoop?: HumanInTheLoopCallback;

  // MCP 连接管理器
  private mcpManager: ConnectionManager | null = null;

  // 上下文压缩管理器
  private contextManager: ContextManager;

  onUsage: ((usage: { inputTokens: number; outputTokens: number; model: string }) => void) | null =
    null;

  // create —— 异步工厂方法，先完成 bootstrap 再构造 ChatService
  static async create(
    config: ChatConfig,
    options: {
      resume?: string;
      maxRounds?: number;
      permissionMode?: PermissionMode;
      humanInTheLoop?: HumanInTheLoopCallback;
      projectRoot?: string;
    } = {},
  ): Promise<ChatService> {
    const projectRoot = options.projectRoot ?? process.cwd();
    const now = new Date();
    let bootstrapContext: BootstrapContext;

    if (options.resume) {
      bootstrapContext = buildResumeContext(
        { projectRoot, now },
        options.resume,
      );
    } else {
      bootstrapContext = buildNewSessionContext({ projectRoot, now });
    }

    return new ChatService(
      config,
      bootstrapContext,
      now,
      { ...options, projectRoot },
    );
  }

  constructor(
    config: ChatConfig,
    bootstrapContext: BootstrapContext,
    now: Date = new Date(),
    options: {
      maxRounds?: number;
      permissionMode?: PermissionMode;
      humanInTheLoop?: HumanInTheLoopCallback;
      projectRoot?: string;
    } = {},
  ) {
    this.config = config;
    this.historyPath = bootstrapContext.sessionSummary?.path
      ?? newSessionPath(now, options.projectRoot);
    this.provider = createProvider(config);
    // 如果有恢复消息则使用它们，否则尝试加载历史文件
    if (bootstrapContext.recoveredMessages.length > 0) {
      this.messages = [...bootstrapContext.recoveredMessages];
    } else {
      this.messages = loadHistory(this.historyPath);
    }
    this.maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
    this.permissionMode = options.permissionMode ?? "default";
    this.humanInTheLoop = options.humanInTheLoop;

    // 注册六个核心工具
    this.registry = new ToolRegistry();
    this.registry.register(readFileTool);
    this.registry.register(writeFileTool);
    this.registry.register(editFileTool);
    this.registry.register(globTool);
    this.registry.register(grepTool);
    this.registry.register(runCommandTool);

    // 提取会话 ID（不含扩展名的文件名）
    const sessionId = basename(historyPath, ".jsonl");

    // 初始化上下文压缩管理器
    this.contextManager = new ContextManager(
      this.provider,
      config,
      sessionId,
    );

    this.agentLoop = new AgentLoop(this.registry, this.contextManager);

    // 构建完整 System Prompt：项目指令 + 记忆索引 + 七个固定模块 + 环境信息
    const builder = new SystemPromptBuilder();
    // 注入恢复后的项目指令与记忆索引
    if (bootstrapContext.instructionText) {
      builder.add(instructionSection(bootstrapContext.instructionText));
    }
    if (bootstrapContext.memoryText) {
      builder.add(memorySection(bootstrapContext.memoryText));
    }
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

  // init —— 异步初始化：加载 MCP 配置并连接外部 Server
  async init(): Promise<void> {
    try {
      const mcpConfig = loadMcpConfig();
      const serverCount = Object.keys(mcpConfig.servers).length;
      if (serverCount > 0) {
        this.mcpManager = new ConnectionManager();
        await this.mcpManager.connectAll(mcpConfig, this.registry);
      }
    } catch (e) {
      console.error(`[MCP] 初始化失败：${(e as Error).message}`);
    }
  }

  // disconnect —— 断开 MCP 连接并释放资源
  async disconnect(): Promise<void> {
    if (this.mcpManager) {
      await this.mcpManager.disconnectAll();
    }
  }

  get history(): Message[] {
    return [...this.messages];
  }

  // 当前模式
  get currentMode(): "full" | "plan" {
    return this.mode;
  }

  // 设置人在回路回调（由 TUI 注入）
  setHumanInTheLoop(callback: HumanInTheLoopCallback): void {
    this.humanInTheLoop = callback;
  }

  async *sendMessage(text: string): AsyncIterable<AgentEvent> {
    this.cancel();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // 解析命令
    if (isCompressCommand(text)) {
      // /compress —— 手动触发上下文压缩
      const result = await this.contextManager.preRequest(this.messages, "manual", signal);
      if (result.events.length > 0) {
        for (const e of result.events) {
          yield e;
        }
      }
      // 用压缩后的消息替换当前历史
      this.messages = result.messages;
      return;
    } else if (isPermissionDefaultCommand(text)) {
      this.permissionMode = "default";
      yield { type: "tool_status", name: "mode", param: "default" };
      return;
    } else if (isPermissionAcceptsEditCommand(text)) {
      this.permissionMode = "acceptsEdit";
      yield { type: "tool_status", name: "mode", param: "acceptsEdit" };
      return;
    } else if (isPlanCommand(text)) {
      // /plan 同时设置 agent plan mode 和 permission plan mode
      this.mode = "plan";
      this.permissionMode = "plan";
      const planMessage = extractPlanMessage(text) || "请分析需求并写入执行计划";
      text = planMessage;
    } else if (isDoCommand(text)) {
      if (this.mode === "plan") {
        this.mode = "full";
        // 退出 plan mode 时恢复 permission mode 为 default
        this.permissionMode = "default";
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
      permissionMode: this.permissionMode,
      humanInTheLoop: this.humanInTheLoop,
    };

    // 构建 PermissionChecker（如有 humanInTheLoop 回调或使用默认）
    const cwd = process.cwd();
    const globalRulesPath = join(homedir(), ".codia", "permissions.yaml");
    const projectRulesPath = join(cwd, ".codia", "permissions.yaml");
    const localRulesPath = join(cwd, ".codia", "permissions.local.yaml");

    const ruleEngine = new RuleEngine(globalRulesPath, projectRulesPath, localRulesPath);
    await ruleEngine.load();

    // 当 TUI 未注入回调时，使用静默 auto-allow 而非 createDefaultHumanCallback()
    // 因为 createDefaultHumanCallback 使用 stdin/stdout，在 Ink 渲染模式下会破坏终端输出
    const humanCallback = this.humanInTheLoop ?? (async () => "yes" as const);
    const permissionChecker = new PermissionChecker(ruleEngine, this.permissionMode, humanCallback);

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
      cwd,
      systemPrompt,
      permissionChecker,
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

    // 异步调度记忆提炼
    this.scheduleMemoryExtraction(prevCount);

    this.abortController = null;
  }

  // scheduleMemoryExtraction —— 自然结束后异步提炼记忆
  private scheduleMemoryExtraction(prevCount: number): void {
    const projectRoot = process.cwd();
    // 读取已有索引
    let existingIndex: MemoryIndexBundle;
    try {
      existingIndex = loadIndexes(projectRoot);
    } catch {
      existingIndex = { project: [], user: [] };
    }

    // 异步提炼，不阻塞主路径
    extractFromTurn(
      {
        sessionId: basename(this.historyPath, ".jsonl"),
        turnRange: { start: prevCount, end: this.messages.length },
        projectRoot,
        existingMemoryIndex: existingIndex,
        triggeredAt: new Date().toISOString(),
      },
      this.messages,
    ).catch((e) => {
      // 记忆提炼失败只记日志，不阻塞
      console.warn("[MemoryExtractor] 提炼失败：", (e as Error).message);
    });
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

// isPermissionDefaultCommand —— 匹配 /default
function isPermissionDefaultCommand(text: string): boolean {
  return /^\/default\s*$/.test(text.trim());
}

// isCompressCommand —— 匹配 /compress
function isCompressCommand(text: string): boolean {
  return /^\/compress\s*$/.test(text.trim());
}

// isPermissionAcceptsEditCommand —— 匹配 /acceptsEdit
function isPermissionAcceptsEditCommand(text: string): boolean {
  return /^\/acceptsEdit\s*$/.test(text.trim());
}
