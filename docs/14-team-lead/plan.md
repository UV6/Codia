# Team Lead — 主 Agent 升级 Plan

## 架构概览

新增 `src/team/` 模块，与现有的 `src/agent/`、`src/worktree/`、`src/tool/` 协作：

```
                    ┌─────────────────────────┐
                    │      ChatService         │
                    │  (接入 Coordinator 过滤)  │
                    └───────┬─────────┬─────────┘
                            │         │
              ┌─────────────┘         └──────────────┐
              ▼                                      ▼
   ┌─────────────────────┐              ┌─────────────────────┐
   │    TeamManager       │              │  CoordinatorFilter  │
   │  创建/加载/持久化小组  │              │  白名单工具过滤      │
   └──────┬──────────────┘              └─────────────────────┘
          │
    ┌─────┼──────────────┬────────────────┐
    ▼     ▼              ▼                ▼
┌──────┐ ┌──────────┐ ┌────────────┐ ┌──────────────┐
│Member│ │TaskBoard │ │MailboxSystem│ │LeadOrchestrator│
│Backend│ │共享任务板 │ │名称注册表+邮箱│ │任务拆解+派生+合并│
└──┬───┘ └──────────┘ └─────┬──────┘ └──────┬───────┘
   │                        │               │
   ▼                        ▼               ▼
┌───────────────┐  ┌──────────────┐  ┌─────────────┐
│ SubAgentRunner │  │ ~/.codia/    │  │WorktreeManager│
│ + tmux 控制    │  │ teams/<name>/│  │  (已有)      │
│ (已有)         │  │ 文件系统     │  └─────────────┘
└───────────────┘  └──────────────┘
```

- **TeamManager:** 小组生命周期入口，创建/加载/保存小组配置
- **MemberBackend:** 成员运行时后端，封装 tmux 和 in-process 两种模式
- **SharedTaskBoard:** 共享任务板，JSON 文件持久化，带锁
- **MailboxSystem:** 名称注册表 + 邮箱文件 + 锁文件机制
- **LeadOrchestrator:** Lead 专属能力——任务拆解、派生成员、git 合并工作目录
- **CoordinatorFilter:** 实现 F8 的工具白名单过滤
- **TeamTools:** 向小组成员暴露的协作工具集

## 核心数据结构

### TeamConfig（小组配置）

```typescript
interface TeamConfig {
  name: string;                    // 小组名称
  lead: string;                    // Lead 成员名称
  members: MemberInfo[];           // 成员花名册
  createdAt: string;               // ISO 8601
  updatedAt: string;
}
```

### MemberInfo（成员信息）

```typescript
interface MemberInfo {
  name: string;                    // 成员名称（唯一标识）
  role: "lead" | "worker";        // 角色
  workDir: string;                 // git worktree 路径或共享 cwd
  backend: "tmux" | "in-process"; // 运行时后端
  requiresApproval: boolean;       // 是否需要审批
  status: "active" | "idle" | "stopped"; // 当前状态
  contextDir: string;              // 上下文持久化目录
  sessionId: string | null;        // tmux session ID 或进程 ID（活跃时）
}
```

### SharedTask（共享任务）

```typescript
interface SharedTask {
  id: string;                      // UUID
  title: string;                   // 简短标题
  description: string;             // 任务描述
  status: "pending" | "in_progress" | "completed" | "failed";
  assignee: string | null;         // 负责成员名称（null = 未分配）
  dependencies: string[];          // 依赖任务 ID 列表
  createdAt: string;               // ISO 8601
  updatedAt: string;
}
```

### TeamMessage（消息）

```typescript
interface TeamMessage {
  id: string;                      // UUID
  from: string;                    // 发件人名称
  to: string | "*";                // 收件人名称，"*" 表示广播
  type: "text" | "broadcast" | "approval_request" 
      | "approval_response" | "task_assignment" | "member_idle";
  body: string;                    // 正文（普通文本或 JSON 字符串）
  timestamp: string;               // ISO 8601，系统自动补
  read: boolean;                   // 默认 false
  summary: string;                 // 一行摘要
}
```

### ApprovalResponse（审批响应，JSON 协议）

```typescript
interface ApprovalResponse {
  type: "approval_response";
  action: "approved" | "rejected";
  planId: string;
  reason: string;
}
```

## 模块设计

### 模块 A: TeamManager

**职责：** 小组的创建、加载、更新、删除，成员花名册管理

**文件：** `src/team/team-manager.ts`

**对外接口：**
```typescript
class TeamManager {
  constructor(persistenceRoot: string);  // ~/.codia/teams

  // 创建新小组
  createTeam(name: string, leadName: string): Promise<TeamConfig>;
  // 从磁盘加载已有小组
  loadTeam(name: string): Promise<TeamConfig>;
  // 列出所有小组名称
  listTeams(): Promise<string[]>;
  // 保存小组配置（原子写入）
  saveTeam(config: TeamConfig): Promise<void>;
  // 删除小组
  deleteTeam(name: string): Promise<void>;

  // 添加成员
  addMember(teamName: string, info: MemberInfo): Promise<void>;
  // 移除成员
  removeMember(teamName: string, memberName: string): Promise<void>;
  // 更新成员状态
  updateMemberStatus(teamName: string, memberName: string, status: MemberInfo["status"]): Promise<void>;
}
```

**持久化格式：**
```
~/.codia/teams/<team-name>/
├── group.json       — TeamConfig 序列化（原子写入 .tmp → rename）
├── tasks.json        — SharedTask[] 序列化
└── members/
    ├── registry.json — { [name: string]: "mailbox/<name>.json" }
    └── mailbox/
        ├── <member-a>.json      — TeamMessage[] 序列化
        ├── <member-a>.json.lock — 锁文件
        ├── <member-b>.json
        └── <member-b>.json.lock
```

**依赖：** Node.js `fs/promises`、锁文件工具

### 模块 B: MemberBackend

**职责：** 按环境选择运行时后端，派生成员运行环境

**文件：** `src/team/member-backend.ts`

**对外接口：**
```typescript
class MemberBackend {
  constructor(teamManager: TeamManager, worktreeManager: WorktreeManager);

  // 检测可用的后端类型
  detectAvailable(): "tmux" | "in-process";
  // 检测 tmux 是否可用
  isTmuxAvailable(): boolean;

  // 派生一个成员（自动选后端，含 worktree 创建）
  spawnMember(teamName: string, info: MemberInfo, config: SubAgentConfig): Promise<SpawnResult>;
  // 终止一个成员
  stopMember(teamName: string, memberName: string): Promise<void>;
  // 向 tmux 窗格发送唤醒信号
  wakeMember(teamName: string, memberName: string): Promise<void>;
}

interface SpawnResult {
  memberName: string;
  backend: "tmux" | "in-process";
  degraded: boolean;        // 是否发生了降级
  degradeReason?: string;   // 降级原因（如有）
  sessionId: string | null; // tmux session ID
  workDir: string;
}
```

**后端选择逻辑：**
```
1. 尝试 tmux：检查 $TMUX 或 `tmux -V` 命令是否可用
2. 可用 → 创建 tmux session，在其中启动 Codia 实例
3. 不可用 → 回退 in-process，记录 degradeReason
4. 如果发生了降级 → 通过 MailboxSystem 向 Lead 发送通知消息
5. 无论哪种后端，都通过 WorktreeManager 为成员创建独立 worktree
```

**依赖：** TeamManager、WorktreeManager、SubAgentRunner、MailboxSystem、Node.js `child_process`

### 模块 C: SharedTaskBoard

**职责：** 共享任务板的增删查改，JSON 文件持久化

**文件：** `src/team/shared-task-board.ts`

**对外接口：**
```typescript
class SharedTaskBoard {
  constructor(teamConfig: TeamConfig);

  // 创建任务
  createTask(task: Omit<SharedTask, "id" | "createdAt" | "updatedAt">): Promise<SharedTask>;
  // 获取单个任务
  getTask(taskId: string): Promise<SharedTask | null>;
  // 列出所有任务
  listTasks(filter?: { status?: string; assignee?: string }): Promise<SharedTask[]>;
  // 更新任务
  updateTask(taskId: string, patch: Partial<SharedTask>): Promise<SharedTask>;
  // 删除任务
  deleteTask(taskId: string): Promise<void>;
  // 获取可执行的任务（依赖已满足且状态为 pending）
  getReadyTasks(): Promise<SharedTask[]>;
}
```

**依赖：** Node.js `fs/promises`

### 模块 D: MailboxSystem

**职责：** 名称注册表 + 邮箱文件 + 锁机制 + 结构化消息

**文件：** `src/team/mailbox-system.ts`

**对外接口：**
```typescript
class MailboxSystem {
  constructor(teamConfig: TeamConfig);

  // 注册成员邮箱
  registerMember(name: string): Promise<void>;
  // 注销成员邮箱
  unregisterMember(name: string): Promise<void>;

  // 发送消息
  sendMessage(msg: Omit<TeamMessage, "id" | "timestamp" | "read">): Promise<TeamMessage>;
  // 发送广播
  broadcast(from: string, body: string, summary: string): Promise<TeamMessage[]>;

  // 读取收件箱（指定成员的未读消息）
  readInbox(memberName: string, markAsRead?: boolean): Promise<TeamMessage[]>;
  // 获取消息
  getMessage(memberName: string, messageId: string): Promise<TeamMessage | null>;
  // 标记已读
  markAsRead(memberName: string, messageId: string): Promise<void>;
}

// 锁工具函数
function withFileLock<T>(filePath: string, fn: () => Promise<T>, maxRetries?: number, lockTtlMs?: number): Promise<T>;
```

**锁实现细节：**
```typescript
async function withFileLock<T>(filePath: string, fn: () => Promise<T>, maxRetries = 5, lockTtlMs = 30000): Promise<T> {
  const lockPath = filePath + ".lock";
  for (let i = 0; i < maxRetries; i++) {
    try {
      // 尝试创建锁文件（EXCL 保证原子性）
      await fs.writeFile(lockPath, String(process.pid), { flag: "wx" });
      break;
    } catch {
      // 创建失败（锁已存在）：检查是否过期
      await cleanupStaleLock(lockPath, lockTtlMs);
      if (i === maxRetries - 1) throw new Error("获取锁失败，已达最大重试次数");
      await sleep(50 * (i + 1)); // 递增等待
    }
  }
  try {
    return await fn();
  } finally {
    await fs.unlink(lockPath).catch(() => {}); // 清理锁
  }
}
```

**依赖：** Node.js `fs/promises`、`crypto`（UUID 生成）

### 模块 E: LeadOrchestrator

**职责：** Lead 专属——目标拆解为任务、派生成员、完成后 git 合并

**文件：** `src/team/lead-orchestrator.ts`

**对外接口：**
```typescript
class LeadOrchestrator {
  constructor(
    teamManager: TeamManager,
    taskBoard: SharedTaskBoard,
    mailbox: MailboxSystem,
    memberBackend: MemberBackend,
    projectRoot: string,
  );

  // 将用户目标拆解为任务（调用 LLM 生成任务列表）
  decomposeGoal(goal: string): Promise<SharedTask[]>;

  // 根据任务派生成员
  spawnMembersForTasks(tasks: SharedTask[]): Promise<SpawnResult[]>;

  // 合并所有成员的工作目录
  mergeAllWorktrees(teamName: string): Promise<MergeResult[]>;

  // 回滚单个成员的改动
  rollbackMember(teamName: string, memberName: string): Promise<void>;
}

interface MergeResult {
  memberName: string;
  branch: string;
  status: "merged" | "conflict" | "rolled_back";
  details: string;    // 成功摘要或冲突/回滚原因
}
```

**合并流程：**
```
1. 按成员创建时间排序遍历所有活跃成员
2. 对每个成员的 worktree：
   a. git fetch 该 worktree 的 branch
   b. git merge 到主分支
   c. 冲突不可解决 → git merge --abort，记录回滚
3. 汇总所有 MergeResult
4. 通过消息通知 Lead 合并结果
```

**依赖：** TeamManager、SharedTaskBoard、MailboxSystem、MemberBackend、Node.js `child_process`（git 命令）

### 模块 F: CoordinatorFilter

**职责：** 实现 coordinator 模式的两把锁 + 工具白名单

**文件：** `src/team/coordinator-filter.ts`

**对外接口：**
```typescript
class CoordinatorFilter {
  // 检查 coordinator 是否生效（两把锁）
  static isEnabled(config: AppConfig): boolean;

  // 获取 coordinator 模式下的工具白名单
  static getAllowedTools(): string[];

  // 应用 coordinator 过滤
  static apply(allTools: Tool[], config: AppConfig): Tool[];
}

// 白名单（使用实际注册的工具名）
const COORDINATOR_ALLOWED_TOOLS = [
  "read_file", "run_command", "Agent", "TaskList", "TaskGet", "TaskCreate",
  "TaskUpdate", "SendMessage", "WebFetch", "WebSearch",
  // codegraph_* 系列（MCP 工具前缀）
  "mcp__codegraph__codegraph_search", "mcp__codegraph__codegraph_callers",
  "mcp__codegraph__codegraph_callees", "mcp__codegraph__codegraph_context",
  "mcp__codegraph__codegraph_trace", "mcp__codegraph__codegraph_impact",
  "mcp__codegraph__codegraph_node", "mcp__codegraph__codegraph_explore",
  "mcp__codegraph__codegraph_files", "mcp__codegraph__codegraph_status",
  // 终止和合并工具
  "StopMember", "MergeWorktrees",
];
```

**两把锁逻辑：**
```typescript
static isEnabled(config: AppConfig): boolean {
  // 第一把锁：配置能力开关
  const configEnabled = config.coordinator?.enabled === true;
  // 第二把锁：环境变量
  const envEnabled = process.env.CODIA_COORDINATOR === "1";
  return configEnabled && envEnabled;
}
```

**依赖：** `config/index.ts`（AppConfig）、`tool/types.ts`（Tool）

### 模块 G: TeamTools

**职责：** 向小组成员暴露的协作工具集，集成到工具注册中心

**文件：** `src/team/team-tools.ts`

**对外接口：**
```typescript
// 创建小组协作工具集
function createTeamTools(
  taskBoard: SharedTaskBoard,
  mailbox: MailboxSystem,
  memberName: string,         // 调用者的成员名称
  isLead: boolean,            // 是否为 Lead
  memberBackend?: MemberBackend,   // 用于 StopMember 工具
  orchestrator?: LeadOrchestrator, // 用于 MergeWorktrees 工具
): Tool[];

// 工具清单：
// - TeamTaskList    — 列出共享任务
// - TeamTaskGet     — 获取任务详情
// - TeamTaskCreate  — 创建任务（Lead 可用）
// - TeamTaskUpdate  — 更新任务状态和分配
// - TeamTaskDelete  — 删除任务（Lead 可用）
// - SendMessage     — 发送点对点消息
// - BroadcastMessage — 发送广播（Lead 可用）
// - ReadInbox       — 读取自己的收件箱
// - RequestApproval — 发送审批请求
// - StopMember      — 终止成员（Lead 可用）
// - MergeWorktrees  — 合并工作目录（Lead 可用）
```

每个工具实现 `Tool` 接口，和现有的 `AgentTool`、`TaskListTool` 同一模式。

**依赖：** SharedTaskBoard、MailboxSystem、MemberBackend、LeadOrchestrator、`tool/types.ts`（Tool 接口）

## 模块交互

### 创建小组并委派任务（完整流程）

```
用户输入 "帮我实现 XXX"
    │
    ▼
ChatService
    │
    ▼
TeamManager.createTeam("my-team", "lead")      // F1: 创建小组
    │
    ▼
TeamManager.addMember("worker-1", {...})       // F1: 添加成员
TeamManager.addMember("worker-2", {...})
    │
    ▼
LeadOrchestrator.decomposeGoal(userGoal)        // F6: 拆解任务
    │  → 返回 SharedTask[]
    ▼
SharedTaskBoard.createTask(t1)                  // F3: 写任务到共享板
SharedTaskBoard.createTask(t2)
    │
    ▼
MemberBackend.spawnMember("worker-1", ...)      // F2: 派生成员
    ├─ tmux 可用？→ 创建 tmux session + worktree
    └─ tmux 不可用？→ in-process + worktree + 降级通知
    │  → 返回 SpawnResult
    ▼
Lead 通过 SendMessage 派任务给各成员           // F5: 任务指派消息
    │
    ▼
成员 A 执行任务 ──→ TeamTaskUpdate 标记完成     // F7: 完成标记
成员 B 执行任务 ──→ TeamTaskUpdate 标记完成
    │
    ▼
LeadOrchestrator.mergeAllWorktrees("my-team")   // F6: git 合并
    ├─ git merge worker-1 branch → success
    └─ git merge worker-2 branch → conflict → rollback
    │  → 返回 MergeResult[]
    ▼
结果汇总给用户
```

### 审批流程（F5）

```
Worker (需要审批)                     Lead
    │                                   │
    ├─ RequestApproval(plan_id, plan)   │
    │   → 消息类型: approval_request    │
    │   → Worker 暂停，等待审批         │
    │                                   ├─ ReadInbox() → 看到审批请求
    │                                   ├─ SendMessage({
    │   ← 消息类型: approval_response   │     type: "approval_response",
    │           action: "approved"      │     action: "approved",
    │           planId, reason          │     planId, reason
    │                                   │   })
    ├─ Worker 收到通知，继续执行         │
```

### Coordinator 模式启用流程（F8）

```
Codia 启动
    │
    ├─ 读取配置: coordinator.enabled = true  (锁1)
    ├─ 读取环境变量: CODIA_COORDINATOR=1     (锁2)
    │
    ▼
CoordinatorFilter.isEnabled() → true
    │
    ▼
ToolFilterPipeline 额外层: CoordinatorFilter.apply()
    │
    ▼
Lead 的工具集中 Write/Edit 等返回 error
剩余工具为白名单中的只读+shell+agent+message+merge
```

## 文件组织

```
src/team/
├── types.ts                — 所有 Team 相关类型定义
├── team-manager.ts         — TeamManager 类
├── member-backend.ts       — MemberBackend 类（tmux/in-process）
├── shared-task-board.ts    — SharedTaskBoard 类
├── mailbox-system.ts       — MailboxSystem 类 + withFileLock
├── lead-orchestrator.ts    — LeadOrchestrator 类
├── coordinator-filter.ts   — CoordinatorFilter 类
└── team-tools.ts           — createTeamTools 工厂 + 所有团队工具类

src/__tests__/team/
├── team-manager.test.ts
├── member-backend.test.ts
├── shared-task-board.test.ts
├── mailbox-system.test.ts
├── lead-orchestrator.test.ts
├── coordinator-filter.test.ts
└── team-tools.test.ts

src/
├── agent/tool-filter.ts    — 修改：ToolFilterPipeline 新增 Coordinator 层
├── config/index.ts         — 修改：AppConfig 新增 coordinator 字段
└── chat/chat-service.ts    — 修改：接入 TeamManager 和 CoordinatorFilter
```

## 与现有系统的集成点

| 集成点 | 现有组件 | 变更方式 |
|--------|---------|---------|
| 工具过滤 | `ToolFilterPipeline` | 新增第五层 CoordinatorFilter.apply() |
| 配置 | `AppConfig` | 新增 `coordinator?: { enabled: boolean }` |
| Worktree 创建 | `WorktreeManager` | 复用现有接口，MemberBackend 调用 |
| 子 Agent 运行 | `SubAgentRunner` | 复用，MemberBackend 包装 |
| 工具注册 | `ToolRegistry` | ChatService 层注册团队工具 |
| LLM 调用 | `SubAgentRunner` 内的 AgentLoop | 复用，不新建 LLM 通道 |

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 持久化格式 | JSON 文件 | TaskManager 和 Memory 已用 JSON，保持一致性；可读、可调试，无需引入数据库 |
| 锁机制 | `.lock` 文件 + 原子写入(EXCL) | 跨进程安全（tmux 和 in-process 都能用），无需额外依赖；过期时间 30s 防止死锁 |
| 后端选择 | 抽象成 MemberBackend | 隔离 tmux 和 in-process 的差异，上层只调 spawnMember/stopMember |
| tmux 控制 | child_process 调用 tmux CLI | tmux 无原生 Node 库，CLI 成熟稳定 |
| Coordinator 工具过滤 | 白名单模式 | spec 明确列出保留的工具，白名单更安全；新增工具默认不被放行 |
| 任务拆解 | 由 Lead 调用 LLM 生成任务列表 | Lead 本身就是 LLM Agent，自然适合做拆解；不需要专门的拆解算法 |
| git 合并 | 在 LeadOrchestrator 中直接用 child_process 执行 git 命令 | GitWorktreeOps 不包含 merge/fetch 方法，且合并逻辑是 Lead 专属职责，不应放入通用 worktree 模块 |
| 工具隔离 | 工具注册时根据上下文决定是否注册 | 不改变 ToolRegistry 核心逻辑，只在 ChatService 层判断当前会话是否为小组成员 |