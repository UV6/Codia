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
import { createLoadSkillTool } from "../tool/tools/load-skill.js";
import { AgentLoop, DEFAULT_MAX_ROUNDS } from "../agent/loop.js";
import { PLAN_MODE_PROMPT } from "../agent/plan-mode.js";
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
import { SkillRegistry } from "../skill/registry.js";
import { SkillActivator } from "../skill/activator.js";
import { toSummaries } from "../skill/loader.js";
import type { Skill, SkillDiagnostic } from "../skill/types.js";
import { HookEngine } from "../hook/engine.js";
import { loadAllHooks } from "../hook/loader.js";

// ChatService —— 对话核心
// 负责消息历史管理、会话持久化、模式与权限控制，循环逻辑委托给 AgentLoop
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

  // Hook 系统
  private hookEngine: HookEngine;

  // Skill 系统
  private skillRegistry: SkillRegistry;
  private skillActivator: SkillActivator;
  private skillSummariesText: string;

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

    // 初始化 Skill 系统
    this.skillRegistry = new SkillRegistry();
    const { skills, diagnostics: skillDiags } = bootstrapContext.skillScanData;
    this.skillRegistry.setSummaries(toSummaries(skills));
    this.skillRegistry.setFullSkills(skills);

    // 合并 Skill 诊断
    for (const sd of skillDiags) {
      bootstrapContext.diagnostics.entries.push({
        source: "skill",
        level: sd.level,
        message: sd.message,
        code: sd.level === "error" ? "SKILL_ALLOWED_TOOL_INVALID" : "SKILL_PARSE_WARNING",
      });
    }

    this.skillActivator = new SkillActivator(this.skillRegistry, options.projectRoot ?? process.cwd());

    // 生成 Skill 摘要文本
    const summaryLines = skills.map(
      (s) => `- **/${s.frontmatter.name}**${s.frontmatter.aliases ? ` (/${s.frontmatter.aliases.join(", /")})` : ""}: ${s.frontmatter.description}`,
    );
    this.skillSummariesText = summaryLines.length > 0
      ? `## 可用 Skill\n\n${summaryLines.join("\n")}\n\n使用 /skill-name 或调用 LoadSkill 工具加载 Skill 获取详细指令。`
      : "";

    // 注册六个核心工具
    this.registry = new ToolRegistry();
    this.registry.register(readFileTool);
    this.registry.register(writeFileTool);
    this.registry.register(editFileTool);
    this.registry.register(globTool);
    this.registry.register(grepTool);
    this.registry.register(runCommandTool);

    // 注册 LoadSkill 系统工具（注入 activator）
    this.registry.register(createLoadSkillTool(this.skillActivator));

    // 启动时校验 Skill 白名单（仅内置工具）
    const builtinToolNames = new Set(this.registry.getToolNames());
    const validationDiags = this.skillRegistry.validateAllowedTools(builtinToolNames);
    for (const vd of validationDiags) {
      bootstrapContext.diagnostics.entries.push({
        source: "skill",
        level: vd.level === "error" ? "error" : "warning",
        message: vd.message,
        code: "SKILL_ALLOWED_TOOL_INVALID",
      });
    }

    // 提取会话 ID（不含扩展名的文件名）
    const sessionId = basename(this.historyPath, ".jsonl");

    // 初始化上下文压缩管理器
    this.contextManager = new ContextManager(
      this.provider,
      config,
      sessionId,
    );

    // 初始化 Hook 系统
    const projectRoot = options.projectRoot ?? process.cwd();
    this.hookEngine = new HookEngine(
      loadAllHooks(
        join(homedir(), ".codia", "hooks.yaml"),
        join(projectRoot, ".codia", "hooks.yaml"),
        join(projectRoot, ".codia", "hooks.local.yaml"),
      ),
    );

    this.agentLoop = new AgentLoop(this.registry, this.contextManager, this.hookEngine);

    // 构建完整 System Prompt：Skill 摘要 + 项目指令 + 记忆索引 + 七个固定模块 + 环境信息
    const builder = new SystemPromptBuilder();
    // 注入 Skill 摘要（阶段一）
    if (this.skillSummariesText) {
      builder.add({ name: "skill-summaries", priority: 5, content: this.skillSummariesText });
    }
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

    // 触发 session_start Hook（异步，不阻塞构造）
    this.hookEngine.fire("session_start", {
      session_id: sessionId,
      cwd: projectRoot,
    }).catch(() => {
      // Hook 失败不影响会话
    });
  }

  // getSkillRegistry —— 公开 SkillRegistry 供 TUI 使用
  getSkillRegistry(): SkillRegistry {
    return this.skillRegistry;
  }

  // init —— 异步初始化：加载 MCP 配置，连接外部 Server，触发 startup Hook
  async init(): Promise<void> {
    // 触发 startup Hook
    try {
      await this.hookEngine.fire("startup", {
        pid: process.pid,
        cwd: process.cwd(),
        version: this.config.model ?? "unknown",
      });
    } catch {
      // Hook 失败不影响
    }

    // 注册 shutdown Hook
    process.on("beforeExit", () => {
      this.hookEngine.fire("shutdown", {
        pid: process.pid,
        uptime: process.uptime(),
      }).catch(() => {
        // Hook 失败不影响
      });
    });

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
    // 触发 session_end Hook
    try {
      await this.hookEngine.fire("session_end", {
        session_id: basename(this.historyPath, ".jsonl"),
        message_count: this.messages.length,
      });
    } catch {
      // Hook 失败不影响
    }

    if (this.mcpManager) {
      await this.mcpManager.disconnectAll();
    }
  }

  get history(): Message[] {
    return [...this.messages];
  }

  // 当前会话文件路径
  get sessionPath(): string {
    return this.historyPath;
  }

  // 当前模式
  get currentMode(): "full" | "plan" {
    return this.mode;
  }

  // 当前权限模式
  get currentPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  // 设置人在回路回调（由 TUI 注入）
  setHumanInTheLoop(callback: HumanInTheLoopCallback): void {
    this.humanInTheLoop = callback;
  }

  // setMode —— 切换模式（供 UIContext 调用）
  setMode(mode: "full" | "plan"): void {
    this.mode = mode;
    if (mode === "plan") {
      this.permissionMode = "plan";
    } else {
      this.permissionMode = "default";
    }
  }

  // compact —— 手动触发上下文压缩（供 /compact 命令调用）
  compact(): void {
    const signal = new AbortController().signal;
    this.contextManager.preRequest(this.messages, "manual", signal).then((result) => {
      if (result.events.length > 0) {
        // 压缩发生：替换消息历史
        this.messages = result.messages;
      }
    }).catch((e) => {
      console.warn("[ChatService] compact 失败：", (e as Error).message);
    });
  }

  async *sendMessage(text: string): AsyncIterable<AgentEvent> {
    this.cancel();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

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

    // 构建 System Prompt（含已激活 Skill 正文）
    const activeBodies = this.skillRegistry.getActiveSkillBodies();
    const skillPrefix = activeBodies.length > 0
      ? activeBodies.join("\n\n---\n\n") + "\n\n---\n\n"
      : "";
    const fullSystem = skillPrefix + this.fullSystemPrompt;

    // 获取当前工具白名单
    const allToolNames = this.registry.getToolNames();
    const allowedTools = this.skillRegistry.getEffectiveAllowedTools(allToolNames);

    // 构建 AgentLoop 配置
    const agentConfig: AgentLoopConfig = {
      maxRounds: this.maxRounds,
      mode: this.mode,
      permissionMode: this.permissionMode,
      humanInTheLoop: this.humanInTheLoop,
      allowedTools,
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

    // 本轮 system prompt（激活 Skill 正文 + 基础 prompt + 可选的 plan mode 后缀）
    const systemPrompt = this.mode === "plan"
      ? fullSystem + "\n\n" + PLAN_MODE_PROMPT + "plan.md"
      : fullSystem;

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
