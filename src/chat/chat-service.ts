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
  agentRolesSection,
} from "../prompt/sections.js";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";
import type { PermissionMode, HumanInTheLoopCallback } from "../permission/types.js";
import { RuleEngine } from "../permission/rule-engine.js";
import { PermissionChecker } from "../permission/checker.js";
import { ConnectionManager } from "../mcp/manager.js";
import { loadMcpConfig } from "../mcp/config.js";
import { buildNewSessionContext, buildResumeContext } from "../bootstrap/context-builder.js";
import type { BootstrapContext } from "../bootstrap/types.js";
import { extractFromTurn } from "../memory/extractor.js";
import type { MemoryExtractionJob, MemoryIndexBundle } from "../memory/types.js";
import { loadIndexes, listNotes } from "../memory/store.js";
import { setMemoryInfoProvider } from "../command/builtin/memory.js";
import { SkillRegistry } from "../skill/registry.js";
import { SkillActivator } from "../skill/activator.js";
import { toSummaries } from "../skill/loader.js";
import type { Skill, SkillDiagnostic } from "../skill/types.js";
import { HookEngine } from "../hook/engine.js";
import { loadAllHooks } from "../hook/loader.js";
import { AgentRoleRegistry } from "../agent/role/registry.js";
import { TaskManager } from "../agent/task-manager.js";
import { AgentTool } from "../agent/agent-tool.js";
import { createTaskTools } from "../agent/task-tools.js";
import { TeamManager } from "../team/team-manager.js";
import { SharedTaskBoard } from "../team/shared-task-board.js";
import { MailboxSystem } from "../team/mailbox-system.js";
import { MemberBackend } from "../team/member-backend.js";
import { LeadOrchestrator } from "../team/lead-orchestrator.js";
import { createTeamTools } from "../team/team-tools.js";
import { createTeamTool } from "../team/create-team-tool.js";
import type { AppConfig } from "../config/index.js";
import { createTeamWithLead } from "../team/create-team.js";
import {
  directoryHasEntries,
  getLegacyWorktreesDir,
  getTeamsRoot,
  getUserCodiaRoot,
  getWorktreesDir,
} from "../storage/paths.js";
import { RealGitWorktreeOps } from "../worktree/git-ops.js";
import { migrateLegacyWorktrees } from "../worktree/migrate.js";
import type { WorktreeMigrationResult } from "../worktree/types.js";

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
  private _maxRounds: number;

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

  // Agent 系统
  private agentRoleRegistry: AgentRoleRegistry;
  private taskManager: TaskManager;

  // Team 系统
  private teamManager: TeamManager;
  private projectRoot: string;

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
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.historyPath = bootstrapContext.sessionSummary?.path
      ?? newSessionPath(now, options.projectRoot);
    this.provider = createProvider(config);
    // 如果有恢复消息则使用它们，否则尝试加载历史文件
    if (bootstrapContext.recoveredMessages.length > 0) {
      this.messages = [...bootstrapContext.recoveredMessages];
    } else {
      this.messages = loadHistory(this.historyPath);
    }
    this._maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
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

    this.skillActivator = new SkillActivator(this.skillRegistry, this.projectRoot);

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
    this.hookEngine = new HookEngine(
      loadAllHooks(
        join(getUserCodiaRoot(), "hooks.yaml"),
        join(this.projectRoot, ".codia", "hooks.yaml"),
        join(this.projectRoot, ".codia", "hooks.local.yaml"),
      ),
    );

    this.agentLoop = new AgentLoop(this.registry, this.contextManager, this.hookEngine);

    // 初始化 Agent 系统
    this.agentRoleRegistry = new AgentRoleRegistry(this.projectRoot);
    this.agentRoleRegistry.reload();

    this.taskManager = new TaskManager();
    this.taskManager.onComplete((task) => {
      // 注入 <task-notification> 到主对话
      const content = [
        `<task-notification>`,
        `  <id>${task.id}</id>`,
        `  <status>${task.status}</status>`,
        `  <type>${task.type}</type>`,
        `  <description>${task.description}</description>`,
        task.result ? `  <result>${task.result.text.slice(0, 500)}</result>` : "",
        `</task-notification>`,
      ].join("\n");
      this.messages.push({
        role: "user",
        content,
        timestamp: new Date().toISOString(),
      });
    });

    // 注册 Agent 工具
    this.registry.register(
      new AgentTool(
        this.agentRoleRegistry,
        this.taskManager,
        config,
        this.provider,
        () => this.messages,
        () => this.registry,
        this.hookEngine,
      ),
    );

    // 注册任务管理工具
    for (const tool of createTaskTools(this.taskManager)) {
      this.registry.register(tool);
    }

    // 初始化 Team 系统
    this.teamManager = new TeamManager();
    this.registry.register(createTeamTool(this.teamManager));

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
    builder.add(
      agentRolesSection(
        this.agentRoleRegistry.list().map((role) => ({
          name: role.frontmatter.name,
          description: role.frontmatter.description,
        })),
      ),
    );
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

    // 注册记忆信息 provider（供 /memory 命令使用）
    setMemoryInfoProvider(() => {
      const projectNotes = listNotes("project", this.projectRoot);
      const userNotes = listNotes("user", this.projectRoot);

      const categoryLabel: Record<string, string> = {
        user_preference: "用户偏好",
        correction_feedback: "纠正反馈",
        project_knowledge: "项目知识",
        reference_material: "参考资料",
      };

      const formatGroup = (label: string, notes: typeof projectNotes): string => {
        if (notes.length === 0) return "";
        // 按分类分组
        const groups = new Map<string, typeof notes>();
        for (const n of notes) {
          const cat = categoryLabel[n.category] ?? n.category;
          if (!groups.has(cat)) groups.set(cat, []);
          groups.get(cat)!.push(n);
        }
        const lines: string[] = [`📋 ${label}（${notes.length} 条）：`];
        for (const [cat, items] of groups) {
          for (const item of items) {
            lines.push(`  [${cat}] ${item.title}`);
          }
        }
        return lines.join("\n");
      };

      const projectText = formatGroup("项目记忆", projectNotes);
      const userText = formatGroup("用户记忆", userNotes);

      if (!projectText && !userText) {
        return "暂无记忆。Codia 会在对话中自动提炼项目知识和个人偏好。";
      }
      return [projectText, userText].filter(Boolean).join("\n\n");
    });

    // 触发 session_start Hook（异步，不阻塞构造）
    this.hookEngine.fire("session_start", {
      session_id: sessionId,
      cwd: this.projectRoot,
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
        cwd: this.projectRoot,
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

  // 模型名称
  get currentModel(): string {
    return this.config.model;
  }

  // 最大轮次数
  get maxRounds(): number {
    return this._maxRounds;
  }

  // 已注册工具数
  get toolCount(): number {
    return this.registry.getToolNames().length;
  }

  // 已连接 MCP 服务数
  get mcpCount(): number {
    return this.mcpManager?.clientCount ?? 0;
  }

  // 可用 Skill 数
  get skillCount(): number {
    return this.skillRegistry.getSummaries().length;
  }

  // 已激活 Skill 数
  get activeSkillCount(): number {
    return this.skillRegistry.getActiveSkillBodies().length;
  }

  // 可用 Agent 角色数
  get agentRoleCount(): number {
    return this.agentRoleRegistry.list().length;
  }

  // 设置人在回路回调（由 TUI 注入）
  setHumanInTheLoop(callback: HumanInTheLoopCallback): void {
    this.humanInTheLoop = callback;
  }

  // getTeamManager —— 获取 TeamManager 实例
  get teamManagerInstance(): TeamManager {
    return this.teamManager;
  }

  private async createPermissionChecker(cwd: string): Promise<PermissionChecker> {
    const globalRulesPath = join(getUserCodiaRoot(), "permissions.yaml");
    const projectRulesPath = join(cwd, ".codia", "permissions.yaml");
    const localRulesPath = join(cwd, ".codia", "permissions.local.yaml");

    const ruleEngine = new RuleEngine(globalRulesPath, projectRulesPath, localRulesPath);
    await ruleEngine.load();

    // 当 TUI 未注入回调时，使用静默 auto-allow 而非 createDefaultHumanCallback()
    // 因为 createDefaultHumanCallback 使用 stdin/stdout，在 Ink 渲染模式下会破坏终端输出
    const humanCallback = this.humanInTheLoop ?? (async () => "yes" as const);
    return new PermissionChecker(ruleEngine, this.permissionMode, humanCallback);
  }

  async createTeam(
    teamName: string,
    leadName: string,
  ): Promise<{ name: string; lead: string }> {
    const permissionChecker = await this.createPermissionChecker(this.projectRoot);
    const groupPath = join(getTeamsRoot(), teamName, "group.json");
    const permission = await permissionChecker.check({
      toolName: "CreateTeam",
      toolType: "file",
      destructive: true,
      params: {
        teamName,
        leadName,
        filePath: groupPath,
      },
      cwd: this.projectRoot,
      targetPaths: [groupPath],
      extraAllowedRoots: [getTeamsRoot()],
    });

    if (permission.decision === "deny") {
      throw new Error(`权限被拒绝：${permission.reason}`);
    }

    const team = await createTeamWithLead(this.teamManager, teamName, leadName);
    return { name: team.name, lead: team.lead };
  }

  async migrateLegacyWorktrees(): Promise<WorktreeMigrationResult> {
    const cwd = this.projectRoot;
    const legacyRoot = getLegacyWorktreesDir(cwd);
    const targetRoot = getWorktreesDir(cwd);

    if (!directoryHasEntries(legacyRoot)) {
      return { moved: [], skipped: [] };
    }

    const ops = new RealGitWorktreeOps(cwd);
    return migrateLegacyWorktrees(legacyRoot, targetRoot, ops);
  }

  // setupTeamSession —— 为当前会话注册团队协作工具
  // memberName: 当前成员名称，isLead: 是否为 Lead
  async setupTeamSession(
    teamName: string,
    memberName: string,
    isLead: boolean,
  ): Promise<{ taskBoard: SharedTaskBoard; mailbox: MailboxSystem }> {
    const teamDir = this.teamManager.getTeamDir(teamName);

    // 创建团队子系统实例
    const taskBoard = new SharedTaskBoard(teamDir);
    const mailbox = MailboxSystem.fromTeamDir(teamDir);
    const memberBackend = new MemberBackend(this.teamManager, mailbox);
    const orchestrator = new LeadOrchestrator(
      this.teamManager,
      taskBoard,
      mailbox,
      memberBackend,
      this.projectRoot,
    );

    // 获取 Lead 名称
    const team = await this.teamManager.loadTeam(teamName);
    const leadName = team.lead;

    // 注册团队协作工具到 ToolRegistry
    const teamTools = createTeamTools(
      taskBoard,
      mailbox,
      memberName,
      isLead,
      leadName,
      memberBackend,
      orchestrator,
    );
    for (const tool of teamTools) {
      this.registry.register(tool);
    }

    return { taskBoard, mailbox };
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

  // setPermissionMode —— 独立切换权限模式（供 /acceptsedit 等命令调用）
  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  // 上下文信息（供 /context 命令使用）
  getContextInfo(): { estimatedTokens: number; messageCount: number; maxTokens: number } {
    return {
      estimatedTokens: this.contextManager.estimateTokens(this.messages),
      messageCount: this.messages.length,
      maxTokens: this.contextManager.contextWindow,
    };
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
      maxRounds: this._maxRounds,
      mode: this.mode,
      permissionMode: this.permissionMode,
      humanInTheLoop: this.humanInTheLoop,
      allowedTools,
    };

    // 构建 PermissionChecker（如有 humanInTheLoop 回调或使用默认）
    const cwd = this.projectRoot;
    const permissionChecker = await this.createPermissionChecker(cwd);

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
    const projectRoot = this.projectRoot;

    // 读取已有索引
    let existingIndex: MemoryIndexBundle;
    try {
      existingIndex = loadIndexes(projectRoot);
    } catch {
      existingIndex = { project: [], user: [] };
    }

    const job: MemoryExtractionJob = {
      sessionId: basename(this.historyPath, ".jsonl"),
      turnRange: { start: Math.max(0, prevCount - 1), end: this.messages.length },
      projectRoot,
      existingMemoryIndex: existingIndex,
      triggeredAt: new Date().toISOString(),
    };

    // 用独立的 AbortController，不跟主对话共享
    const signal = new AbortController().signal;

    // 异步提炼，不阻塞主路径
    extractFromTurn(
      job,
      this.messages,
      this.provider,
      this.config,
      signal,
    )
      .then(({ upserted, deleted }) => {
        if (upserted.length > 0) {
          console.log(`[MemoryExtractor] 提炼记忆 ${upserted.length} 条：${upserted.map((n) => n.title).join(", ")}`);
        }
        if (deleted.length > 0) {
          console.log(`[MemoryExtractor] 删除记忆 ${deleted.length} 条：${deleted.join(", ")}`);
        }
      })
      .catch((e) => {
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
    info.push(`工作目录: ${this.projectRoot}`);

    try {
      const gitBranch = execSync("git branch --show-current", {
        cwd: this.projectRoot,
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
