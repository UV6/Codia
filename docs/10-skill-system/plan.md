# Skill 系统 Plan

## 架构概览

Skill 系统由 6 个模块组成，分层清晰：

**`src/skill/types.ts`** — 核心类型定义。Skill 的 frontmatter 解析结构、完整 Skill 对象、阶段一摘要 SkillSummary、诊断信息 SkillDiagnostic。

**`src/skill/loader.ts`** — Skill 加载器。负责扫描三层目录（内置/用户/项目），解析每个 Skill 文件，按优先级去重（项目覆盖用户覆盖内置），返回可用 Skill 列表和诊断信息。单文件解析失败跳过不阻断。

**`src/skill/registry.ts`** — Skill 注册中心。持有两份数据：阶段一的摘要列表（name + description）和阶段二已激活 Skill 的完整正文。提供激活/反激活/清空/热更新接口。

**`src/skill/activator.ts`** — Skill 激活协调器。调用 Loader 读取完整正文，做参数占位符替换，维护激活状态，提供上下文注入文本。

**`src/skill/builtin/`** — 内置 Skill 目录。存放 commit.md、review.md、test.md 三个样板 Skill。

**生命周期：** SkillRegistry 在 ChatService 中作为唯一实例创建，通过 BootstrapContext 传递原始扫描数据（skills + diagnostics），ChatService 负责构造并持有 SkillRegistry。避免双实例不同步。

**与现有系统集成点：**
- 命令系统（`src/command/`）：启动时在现有 CommandRegistry 中为每个 Skill 自动注册 `/skill-name` 斜杠命令及别名（如 `cr`），类型为 `prompt`，触发时走现有 dispatch 流程送入 Agent。
- 工具系统（`src/tool/`）：注册 LoadSkill 为系统工具，Agent 通过 tool call 机制按需激活 Skill。
- Agent 循环（`src/agent/loop.ts`）：扩展 AgentLoopConfig，支持 `allowedTools` 过滤——在 full mode 时也应用白名单（目前仅 plan mode 有工具过滤）。
- 上下文构建（`src/bootstrap/context-builder.ts`）：扩展现有 `buildNewSessionContext`，扫描 Skill 并将原始数据传入 BootstrapContext，由 ChatService 统一管理。

## 核心数据结构

### SkillFrontmatter — YAML frontmatter 解析结果

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 唯一标识，小写字母+连字符，如 `commit`、`code-review` |
| description | string | 是 | 一句话说明，用于阶段一摘要和意图匹配 |
| mode | `"inline" \| "fork"` | 是 | 执行模式 |
| allowedTools | string[] | 否 | 可见工具白名单，缺省表示不限制（LoadSkill 始终可用） |
| aliases | string[] | 否 | 命令别名，如 `["cr"]` |
| historyRounds | number | 否 | fork 模式带入的历史轮数，仅 mode=fork 时有效 |
| model | string | 否 | 指定模型，如 `claude-sonnet-4-6` |

### Skill — 完整 Skill 对象

| 字段 | 类型 | 说明 |
|------|------|------|
| source | `"builtin" \| "user" \| "project"` | 来源层级 |
| dir | string | 所在目录路径（目录型 Skill 时有效） |
| frontmatter | SkillFrontmatter | 解析后的元信息 |
| body | string | Markdown 正文（未经参数替换的原始 SOP 指令） |

### SkillSummary — 阶段一摘要

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | Skill 标识 |
| description | string | 一句话说明 |
| source | string | 来源层级 |

### SkillDiagnostic — 诊断信息

| 字段 | 类型 | 说明 |
|------|------|------|
| filePath | string | 来源文件路径 |
| level | `"error" \| "warning"` | 严重级别 |
| message | string | 具体原因 |

### SkillLoadResult — LoadSkill 工具返回值

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 已加载的 Skill 名 |
| mode | string | 执行模式 |
| body | string | 经参数替换后的正文 |
| resources | string[] | 目录型 Skill 的附属资源文件列表 |

## 模块设计

### 模块 A：types.ts — 类型定义

**职责：** 定义所有 Skill 相关类型，无业务逻辑。
**对外接口：** 导出 `SkillFrontmatter`、`Skill`、`SkillSummary`、`SkillDiagnostic`、`SkillLoadResult` 类型。
**依赖：** 无。

### 模块 B：loader.ts — 文件扫描与解析

**职责：**
- 扫描三层目录（`<codia>/skills/builtin/`、`~/.codia/skills/`、`<project>/.codia/skills/`）
- 解析每个 Skill 文件（YAML frontmatter + Markdown 正文）
- 区分单文件 Skill 和目录型 Skill
- 按优先级覆盖：项目 > 用户 > 内置
- 解析失败的单个文件跳过并产生 `SkillDiagnostic`

**对外接口：**
- `scanAll(projectRoot: string): { skills: Skill[]; diagnostics: SkillDiagnostic[] }` — 扫描全部三层，去重覆盖
- `loadOne(name: string, projectRoot: string): Skill | null` — 按名加载单个 Skill
- `getDirs(projectRoot: string): { builtin: string; user: string; project: string }` — 返回三层目录路径

**依赖：** types.ts、Node.js fs/path、现有 `src/config/`

### 模块 C：registry.ts — 注册中心

**职责：**
- 持有阶段一摘要列表（`SkillSummary[]`）
- 持有已激活 Skill 的完整正文（`Map<string, Skill>`）
- 管理工具白名单（多个激活 Skill 的 allowedTools 取并集，无限制 Skill 则全部可用）
- 提供激活/反激活/清空接口

**对外接口：**
- `setSummaries(summaries: SkillSummary[]): void` — 启动时设置摘要列表
- `getSummaries(): SkillSummary[]` — 获取阶段一摘要
- `activate(skill: Skill, args?: string[]): SkillLoadResult` — 激活 Skill
- `deactivate(name: string): void` — 反激活单个 Skill
- `clear(): void` — 清空所有激活
- `getActiveSkillBodies(): string[]` — 获取激活 Skill 正文
- `getActiveSummaries(): string[]` — 获取激活 Skill 状态行
- `getEffectiveAllowedTools(allTools: string[]): string[]` — 计算工具白名单：取所有激活 Skill 的 allowedTools 并集；若任一 Skill 无 allowedTools 限制则返回全部 allTools。结果集中始终包含 `LoadSkill`。
- `validateAllowedTools(allToolNames: Set<string>): SkillDiagnostic[]` — 校验白名单（仅内置工具，MCP 异步注册的工具除外）

**依赖：** types.ts

### 模块 D：activator.ts — 激活协调器

**职责：**
- 协调 Loader 和 Registry，完成 Skill 激活流程
- 做参数占位符替换（`{{arg1}}` → 用户输入值）
- 目录型 Skill 的资源文件列表构建
- 返回 `SkillLoadResult` 供上下文注入

**对外接口：**
- `loadSkill(name: string, args?: string[], projectRoot?: string): SkillLoadResult | null` — 加载并激活 Skill
- `loadSkillByIntent(task: string, projectRoot?: string): SkillLoadResult | null` — 意图匹配

**依赖：** loader.ts、registry.ts、types.ts

### 模块 E：builtin/ — 内置 Skill 文件

**职责：** 提供三个开箱即用的 Skill 文件。
**文件：**
- `builtin/commit.md` — inline 模式
- `builtin/review.md` — fork 模式
- `builtin/test.md` — inline 模式
**依赖：** 无。

### 模块 F：集成 — 现有系统改动

**改动范围：**

1. **`src/tool/registry.ts`** — 注册 LoadSkill 为系统工具；新增 `getToolNames()` 和 `getMetasWithFilter()` 方法
2. **`src/command/registry.ts`** — 启动时为 Skill 自动注册斜杠命令及别名
3. **`src/bootstrap/context-builder.ts`** — 扫描 Skill，将 `{ skills, diagnostics }` 原始数据传入 BootstrapContext
4. **`src/bootstrap/types.ts`** — 扩展 BootstrapContext：`skillScanData: { skills: Skill[]; diagnostics: SkillDiagnostic[] }`
5. **`src/tui/app.tsx`** — 清空对话时调用 `skillRegistry.clear()`
6. **`src/chat/chat-service.ts`** — 从 BootstrapContext.skillScanData 创建唯一的 SkillRegistry 实例，向 AgentLoop 暴露 allowedTools 过滤器
7. **`src/agent/types.ts`** — AgentLoopConfig 新增 `allowedTools?: string[]` 字段
8. **`src/agent/loop.ts`** — full mode 时也应用 allowedTools 过滤（如果配置了）

## 模块交互

### 启动流程

```
App 启动
  │
  ├─→ Loader.scanAll(projectRoot)
  │     ├─ 扫描 builtin/、~/.codia/skills/、<project>/.codia/skills/
  │     ├─ 解析 YAML frontmatter，按 name 去重覆盖
  │     └─ 返回 { skills, diagnostics }
  │
  ├─→ Registry.setSummaries(skills → SkillSummary[])
  ├─→ Registry.validateAllowedTools(allToolNames) → diagnostics
  │
  ├─→ 为每个 Skill 注册 /name 斜杠命令 (CommandRegistry)
  ├─→ 注册 LoadSkill 系统工具 (ToolRegistry)
  │
  └─→ ContextBuilder 注入 Skill 摘要到对话上下文
```

### 激活流程（显式 `/skill-name arg1 arg2`）

```
用户输入 /review
  │
  ├─→ CommandParser 解析为 ParseResult{ name: "review", args: "" }
  ├─→ CommandDispatcher 分发（type: "prompt"）
  │     └─ 将 LoadSkill 调用注入 Agent 消息流
  │
  └─→ Agent 调用 LoadSkill 工具
        │
        ├─→ Activator.loadSkill("review", args, projectRoot)
        │     ├─ Loader.loadOne("review") → Skill 对象
        │     └─ Registry.activate(skill, args)
        │           └─ 参数替换 {{arg1}} → 用户输入
        │
        ├─→ 返回 SkillLoadResult{ name, mode, body, resources }
        └─→ 下轮对话 ContextBuilder 注入激活 Skill 正文
```

### 激活流程（意图识别）

```
用户说 "帮我 review 代码"
  │
  └─→ Agent 自行判断：需要 review Skill
        │
        └─→ Agent 调用 LoadSkill(name: "review")
              └─ （后续同上）
```

### Fork 模式 vs Inline 模式

```
Skill 激活后，Agent 收到 Skill 正文
  │
  ├─ mode=inline
  │   └─ Agent 在当前对话中执行 SOP → 结果留在主历史
  │
  └─ mode=fork
        ├─ ChatService 创建独立 Message[]（可选：从主历史带入最近 N 轮）
        ├─ 在新上下文中运行 AgentLoop
        ├─ 收集执行结果，提取摘要
        ├─ 将摘要作为 tool_result 写回主对话
        └─ 主对话继续（不包含 fork 中间交互）
```

## 文件组织

```
src/skill/
├── types.ts          — SkillFrontmatter、Skill、SkillSummary、SkillDiagnostic、SkillLoadResult
├── loader.ts         — scanAll、loadOne、getDirs，YAML frontmatter 解析
├── registry.ts       — SkillRegistry：摘要、激活、白名单（+LoadSkill）、校验
├── activator.ts      — loadSkill、loadSkillByIntent，参数替换
└── builtin/
    ├── commit.md     — inline 模式，自动提交
    ├── review.md     — fork 模式，五维度审查
    └── test.md       — inline 模式，测试分析

src/command/
├── builtin/
│   └── index.ts     — [改动] 命令列表从 Skill Registry 动态获取，含别名
└── dispatcher.ts     — [不改动] 复用现有 dispatch

src/tool/
├── tools/
│   └── load-skill.ts — [新建] LoadSkill 系统工具定义
├── registry.ts       — [改动] 注册 LoadSkill；新增 getToolNames/getMetasWithFilter
└── types.ts          — [不改动] 复用现有 Tool、ToolResult

src/agent/
├── types.ts          — [改动] AgentLoopConfig 新增 allowedTools 字段
└── loop.ts           — [改动] full mode 时也应用 allowedTools 过滤

src/bootstrap/
├── types.ts          — [改动] BootstrapContext 新增 skillScanData
└── context-builder.ts — [改动] 扫描 Skill，返回原始数据

src/tui/
└── app.tsx           — [改动] 清空对话时清除 Skill 激活
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| YAML 解析库 | `yaml` npm 包，只解析 frontmatter | Node.js 无内置 YAML 解析，用社区标准库 |
| 三层目录路径 | 内置 `<codia>/skills/builtin/`；用户 `~/.codia/skills/`；项目 `<root>/.codia/skills/` | 与现有 MEWCODE.md 三层加载路径模式一致 |
| 命令类型 | 复用现有 `"prompt"` 类型 Command | 现有 dispatch 已支持 prompt 型 |
| Fork 实现方式 | 复用现有 Agent loop + 新 Agent 实例 | 不引入进程隔离，Fork = 新对话上下文 + 独立 Agent |
| 白名单计算 | 多 Skill 激活取并集，始终包含 LoadSkill；有任一不限则全部可用 | 安全优先：显式限制才收窄；LoadSkill 不受限保证 Skill 间互调 |
| SkillRegistry 实例 | BootstrapContext 传原始数据，ChatService 创建唯一实例 | 避免 ContextBuilder 和 ChatService 各持一个实例导致激活状态不同步 |
| MCP 工具校验 | 启动时仅校验内置工具，MCP 工具不做启动校验 | MCP 工具异步注册，启动时尚未就绪 |
| 单文件/目录型冲突 | 同一目录下两者同时存在时，目录型优先 | 目录型更完整（含资源），视为更精确的意图 |
| 参数替换时机 | LoadSkill 调用时立即替换 | 替换后缓存到 Registry，每轮无需重复解析 |
| 意图匹配 | Agent 自行读 name/description 匹配 | Agent tool use 机制本身就是意图决策器 |
| 文件扫描 | Node.js fs 同步 API | 启动阶段一次性扫描，异步无收益 |
