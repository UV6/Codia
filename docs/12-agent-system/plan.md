# Agent 系统 Plan

## 架构概览

整个 Agent 系统由六个模块组成：

1. **角色管理** (`src/agent/role/`)：加载 `.codia/agents/` 目录下的角色 Markdown 文件，解析 YAML frontmatter，按四级优先级合并，提供按名查找接口
2. **Agent 工具** (`src/agent/agent-tool.ts`)：实现统一的 Agent 工具，解析参数、分流定义式/Fork 式、调用子 Agent 运行器
3. **子 Agent 运行器** (`src/agent/sub-agent-runner.ts`)：构造隔离的运行时环境（消息历史、权限检查器、工具过滤），驱动 AgentLoop 跑到底
4. **工具过滤管线** (`src/agent/tool-filter.ts`)：四层过滤器链，全局禁止 → 自定义禁止 → 后台白名单 → 角色定义
5. **后台任务管理器** (`src/agent/task-manager.ts`)：追踪后台子 Agent 的状态、结果、用量，注入完成通知
6. **任务管理工具** (`src/agent/task-tools.ts`)：TaskList/TaskGet/TaskCreate/TaskUpdate 四个工具，Agent 可调用查询/操作后台任务

模块间的调用链：

```
ChatService
  └→ ToolRegistry.register(AgentTool)
       └→ AgentTool.execute()
            ├→ AgentRoleRegistry.resolve(name)     // 加载角色
            ├→ ToolFilterPipeline.apply(tools, role) // 过滤工具
            ├→ SubAgentRunner.run(config)            // 子 Agent 循环
            │    └→ AgentLoop.run(...)
            └→ TaskManager.track(task)               // 后台追踪
                 └→ inject <task-notification>
```

ChatService 与子 Agent 系统之间通过 ToolRegistry 注入 Agent 工具实现连接，无需修改 ChatService 主流程。

---

## 核心数据结构

### AgentRoleFrontmatter

角色 Markdown 文件的 YAML frontmatter 解析结果。

```typescript
interface AgentRoleFrontmatter {
  name: string;              // 唯一标识，小写字母+连字符
  description: string;       // 一句话用途说明
  model?: "inherit" | "haiku" | "sonnet" | "opus";  // 默认 "inherit"
  maxRounds?: number;        // 最大轮次，默认 20
  permissionMode?: "default" | "acceptsEdit" | "plan" | "bypassPermissions";
  tools?: string[];          // 白名单，缺省不限
  disallowedTools?: string[];// 黑名单，在白名单基础上再剔除
}
```

### AgentRole

加载后的完整角色对象，Body 伴随子 Agent 整个生命周期。

```typescript
interface AgentRole {
  source: "builtin" | "plugin" | "user" | "project";
  frontmatter: AgentRoleFrontmatter;
  body: string;              // Markdown 正文，子 Agent 的系统提示
  filePath?: string;         // 来源文件路径（内置角色无）
}
```

### SubAgentConfig

子 Agent 运行器的输入配置，由 Agent 工具解析参数后构造。

```typescript
interface SubAgentConfig {
  type: "definition" | "fork";
  role?: AgentRole;          // 定义式必填
  prompt: string;            // 任务描述
  description: string;       // 简短描述，用于进度展示
  name?: string;             // 显示名称
  model?: string;            // 模型覆盖
  runInBackground: boolean;  // 是否后台运行（Fork 强制 true）
  parentMessages: Message[]; // 父对话消息（Fork 式继承用）
  parentProvider: LLMProvider;
  parentRegistry: ToolRegistry;
  parentHookEngine?: HookEngine;
  cwd: string;               // 工作目录
  signal: AbortSignal;       // 取消信号，父 Agent 取消时级联
}
```

### SubAgentResult

子 Agent 运行完成后的返回结果。

```typescript
interface SubAgentResult {
  status: "completed" | "failed" | "max_rounds" | "cancelled";
  text: string;              // 子 Agent 的最终文本输出
  usage: {
    inputTokens: number;
    outputTokens: number;
    model: string;
  };
  rounds: number;            // 实际执行的轮次数
  toolCalls: number;         // 实际执行了多少次工具调用
}
```

### BackgroundTask

后台任务管理器中的单条追踪记录。

```typescript
interface BackgroundTask {
  id: string;                // 唯一标识，如 "task-<timestamp>-<random>"
  status: "running" | "completed" | "failed";
  type: string;              // 角色名或 "fork"
  description: string;       // 创建时的描述
  startTime: string;         // ISO 8601
  result?: SubAgentResult;   // 完成时填充
}
```

---

## 模块设计

### 模块 A: 角色加载器 (`src/agent/role/`)

**职责：** 从四级来源加载 Agent 角色 Markdown 文件，解析 YAML frontmatter，按优先级合并，提供按名查找接口。

**对外接口：**

```typescript
class AgentRoleRegistry {
  reload(): void;                           // 重新扫描所有来源，合并角色
  resolve(name: string): AgentRole | null;  // 按名查找，经过优先级合并后的最终角色
  list(): AgentRole[];                      // 列出当前所有可用角色
  getBuiltinRoles(): AgentRole[];           // 内置角色清单
}
```

**依赖：** `yaml` 库，`node:fs`，`src/instruction/loader.ts`（目录扫描逻辑参考）

**内部模块划分：**
- `types.ts` — `AgentRoleFrontmatter`、`AgentRole` 类型
- `builtin.ts` — 四个内置角色的定义（代码内嵌，非文件）
- `loader.ts` — 扫描目录、读取文件、解析 frontmatter
- `registry.ts` — `AgentRoleRegistry` 类，合并逻辑

---

### 模块 B: Agent 工具 (`src/agent/agent-tool.ts`)

**职责：** 实现 Tool 接口，解析 `subagent_type` / `description` / `prompt` 参数，分流执行路径。

**对外接口：**

```typescript
class AgentTool implements Tool {
  readonly name = "Agent";
  readonly type = "search";          // 非 file/shell，不影响权限分类
  readonly readOnly = false;         // 会执行工具，非只读
  readonly destructive = false;      // 不直接修改文件
  readonly inputSchema: ToolInputSchema;
  execute(params, context): Promise<ToolResult>;
}
```

**依赖：** `AgentRoleRegistry`、`SubAgentRunner`、`TaskManager`

**操作流程：**
1. 校验必填参数 `description` 和 `prompt`
2. 解析 `subagent_type`：有值 → 定义式，调用 `registry.resolve(type)` 加载角色；为空 → Fork 式
3. 构造 `SubAgentConfig`
4. 创建 `SubAgentRunner` 实例
5. 根据 `run_in_background` 和子 Agent 类型决定前台/后台执行
6. 前台：直接等待结果后返回；后台：注册到 `TaskManager`，立即返回"已加入后台"消息

---

### 模块 C: 子 Agent 运行器 (`src/agent/sub-agent-runner.ts`)

**职责：** 接收 `SubAgentConfig`，构造隔离的运行时环境，驱动 AgentLoop 跑到底，返回 `SubAgentResult`。

**对外接口：**

```typescript
class SubAgentRunner {
  constructor(config: SubAgentConfig);
  async run(): Promise<SubAgentResult>;
}
```

**内部流程：**

1. **消息构造**：
   - 定义式：`messages = [{ role: "user", content: config.prompt }]`
   - Fork 式：`messages = [...config.parentMessages, { role: "user", content: config.prompt }]`

2. **系统提示构造**：
   - 定义式：角色 body + 基础环境信息
   - Fork 式：复用父 Agent 的 system prompt

3. **工具过滤**：调用 `ToolFilterPipeline.apply(config.parentRegistry.getAll(), config.role, config.runInBackground, config.type)`

4. **权限检查器创建**：独立的 `PermissionChecker` 实例，权限模式按角色定义

5. **AgentLoop 驱动**：复用现有 `AgentLoop.run()`，传入隔离的 messages、filtered tools、独立的 permission checker

6. **结果收集**：监听 AgentLoop 事件流，收集 `text` 类型事件拼接为最终文本，记录 usage 和轮次

**依赖：** `AgentLoop`、`ToolFilterPipeline`、`PermissionChecker`、`RuleEngine`

---

### 模块 D: 工具过滤管线 (`src/agent/tool-filter.ts`)

**职责：** 实现四层过滤器链，输入主工具列表 + 角色配置 + 运行模式，输出过滤后的工具 metas。

**对外接口：**

```typescript
class ToolFilterPipeline {
  static apply(
    allTools: Tool[],
    role: AgentRole | null,
    runInBackground: boolean,
    type: "definition" | "fork",
    customDisallowed?: string[],    // CUSTOM_AGENT_DISALLOWED_TOOLS
  ): ToolMeta[];
}
```

**四层过滤顺序：**

1. `Layer1GlobalBlock` — 全局禁止 `Agent`、`AskUserQuestion`、`TaskStop`
2. `Layer2CustomDisallow` — 根据 `customDisallowed` 列表剔除
3. `Layer3BackgroundAllow` — 仅后台模式下生效，收窄到 `ASYNC_AGENT_ALLOWED_TOOLS` 硬编码列表
4. `Layer4RoleFilter` — 仅定义式生效，应用 `tools` 白名单和 `disallowedTools` 黑名单

**依赖：** 无外部依赖，纯函数式计算

---

### 模块 E: 后台任务管理器 (`src/agent/task-manager.ts`)

**职责：** 追踪后台子 Agent 生命周期，注入完成通知到主对话。

**对外接口：**

```typescript
class TaskManager {
  create(description: string, type: string): string;  // 创建任务，返回 taskId
  update(taskId: string, result: SubAgentResult): void;
  list(): BackgroundTask[];                            // TaskList 工具调用
  get(taskId: string): BackgroundTask | null;          // TaskGet 工具调用
  cancelAll(signal: AbortSignal): void;                // 主 Agent 取消时级联
  onComplete?: (task: BackgroundTask) => void;         // 完成回调，注入通知
}
```

**通知机制：**

`onComplete` 回调由 ChatService 层注册，收到完成事件后：
1. 构造 `<task-notification>` 消息
2. 以 `user` 角色消息形式追加到主对话的 messages 数组
3. 消息内容包含任务 ID、状态、结果摘要

---

### 模块 F: 任务管理工具 (`src/agent/task-tools.ts`)

**职责：** 四个内置工具，Agent 可调用来查询/管理后台任务。

**工具清单：**

| 工具 | Tool name | 参数 | 返回值 |
|------|-----------|------|--------|
| TaskList | `TaskList` | 无 | JSON 格式的后台任务列表，含 id/status/type/description |
| TaskGet | `TaskGet` | `taskId: string` | 单个任务详情，含 result 文本 |
| TaskCreate | `TaskCreate` | `subject: string, description: string` | 创建成功返回 taskId |
| TaskUpdate | `TaskUpdate` | `taskId: string, status: "completed" \| "failed"` | 更新结果 |

**实现方式：**

四个工具均实现 `Tool` 接口，注入 `TaskManager` 引用。`TaskCreate` 和 `TaskUpdate` 标记为 `readOnly: false`（有副作用），`TaskList` 和 `TaskGet` 标记为 `readOnly: true`。

**依赖：** `TaskManager`

---

## 模块交互

主流程调用链：

```
ChatService.sendMessage()
  → AgentLoop.run()
    → LLM 返回 tool_use (Agent)
      → ToolScheduler.schedule()
        → AgentTool.execute()
          ├─ AgentRoleRegistry.resolve(subagent_type)
          ├─ ToolFilterPipeline.apply(allTools, role, bg, type)
          ├─ SubAgentRunner.run(config)
          │   ├─ AgentLoop.run(isolatedMessages, filteredTools, …)
          │   │   → LLM 响应 → 工具执行 → ...循环...
          │   │   → 纯文本完成
          │   └─ 收集 SubAgentResult
          └─ TaskManager (仅后台)
              ├─ create(description, type) → taskId
              └─ onComplete → inject <task-notification>
```

任务管理工具调用链：

```
AgentLoop (主)
  → LLM 返回 tool_use (TaskList)
    → TaskListTool.execute()
      → TaskManager.list()
        → BackgroundTask[] (JSON)
```

后台任务完成后通知注入链：

```
TaskManager.onComplete(task)
  → ChatService.messages.push({
      role: "user",
      content: "<task-notification> id=… status=completed …</task-notification>"
    })
  → 下次 LLM 请求时主 Agent 看到通知
```

---

## 文件组织

```
src/agent/
├── role/
│   ├── types.ts          — AgentRoleFrontmatter, AgentRole 类型
│   ├── builtin.ts        — 四个内置角色定义
│   ├── loader.ts         — 目录扫描、frontmatter 解析
│   └── registry.ts       — AgentRoleRegistry，优先级合并
├── agent-tool.ts         — Agent 工具 Tool 实现
├── sub-agent-runner.ts   — SubAgentRunner，隔离执行
├── tool-filter.ts        — ToolFilterPipeline，四层过滤
├── task-manager.ts       — TaskManager，后台追踪
├── task-tools.ts         — TaskList/TaskGet/TaskCreate/TaskUpdate 工具
├── types.ts              — 现有类型（AgentLoopConfig 等）
├── loop.ts               — 现有 AgentLoop（无需修改）
├── plan-mode.ts          — 现有 plan mode 逻辑
├── stream-collector.ts   — 现有流收集器
└── tool-scheduler.ts     — 现有工具调度器
```

---

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| Agent 工具类型分类 | `type: "search"` | 非 file/shell，不触发路径沙箱或命令黑名单，权限系统对其无额外拦截 |
| 子 Agent 权限模式默认值 | `bypassPermissions` | 子 Agent 不经过人在回路，工具执行直接放行；角色可通过 frontmatter 收紧 |
| 角色加载时机 | 启动时一次性加载 + 手动 reload | 角色配置变更频率低，扫描开销可控 |
| Fork 消息复制方式 | 浅拷贝 messages 数组引用，不深拷贝 Message 对象 | 节省内存，子 Agent 只追加新消息不修改已有对象 |
| 子 Agent 的 Hook 复用 | 复用父 `HookEngine` 实例，子 Agent 的事件上下文带标记 | 用户配置的 Hook 规则在子 Agent 中同样生效，无需重复配置 |
| 工具过滤实现 | 函数式管线而非中间件模式 | 四层顺序固定不变，简单函数链更直观，无需可插拔架构 |
| 是否需要修改现有 AgentLoop | 否 | AgentLoop 已支持独立 messages、独立 permissionChecker、allowedTools 过滤，SubAgentRunner 直接复用现有接口 |
| ChatService 是否需要修改 | 最小修改：仅注入 Agent 工具和 TaskManager | 避免影响已有主流程稳定性 |
