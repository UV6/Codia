# Codia 新人入职指南

> 由 Understand Anything 基于知识图谱自动生成 | 分析时间：2026-06-22 | 提交：`643644a`

---

## 一、项目概览

**Codia** 是一个终端 AI 编程助手（类似 Claude Code），使用 **TypeScript** 实现，基于 **Ink**（React for terminal）构建终端 UI，使用 **Vitest** 作为测试框架。

| 属性 | 值 |
|---|---|
| 语言 | TypeScript (主力), JSON, YAML, Markdown |
| 框架 | Ink, React, Vitest |
| 包管理器 | pnpm@10.33.0 |
| 开发入口 | `pnpm dev` → `tsx bin/codia.tsx` |
| 测试 | `pnpm test` → `vitest run` |
| 类型检查 | `pnpm typecheck` → `tsc --noEmit` |
| 核心依赖 | ink, react, marked, highlight.js, yaml, minimatch |

---

## 二、架构分层（8 层，265 个文件级节点）

依赖方向自顶向下：CLI/TUI → Agent → Tool → LLM / Core，测试层依赖所有层。

### 1. CLI/TUI 交互层（28 文件）

终端用户交互界面，基于 Ink/React。包含应用入口、TUI 组件（聊天视图、输入框、状态栏、Markdown 渲染）以及斜杠命令系统（解析、分发、12 个内置命令）。

| 文件 | 复杂度 | 说明 |
|---|---|---|
| `bin/codia.tsx` | moderate | CLI 入口点，解析命令行参数、加载配置、管理会话生命周期 |
| `src/tui/app.tsx` | complex | TUI 应用主组件，管理消息流、流式输出、权限状态和模式切换 |
| `src/tui/chat-view.tsx` | moderate | 聊天视图组件 |
| `src/tui/markdown-renderer.tsx` | moderate | Markdown 转终端富文本渲染 |
| `src/tui/code-block.tsx` | simple | 代码块语法高亮渲染 |
| `src/tui/status-bar.tsx` | simple | 状态栏（模型、token 用量等） |
| `src/command/parser.ts` | moderate | 斜杠命令解析器（/help、/compact 等） |
| `src/command/registry.ts` | moderate | 命令注册与别名映射，支持模糊匹配 |
| `src/command/dispatcher.ts` | moderate | 命令分发与执行 |
| `src/command/types.ts` | simple | 命令系统类型定义 |
| `src/command/commands/*.ts` | simple～moderate | 12 个内置命令（help、compact、clear、memory、plan、review、status 等） |

### 2. Agent 执行层（37 文件）

Agent 主循环、子 Agent 调度、多 Agent 协作、Skill 系统、Chat 服务编排、会话引导与上下文构建。是系统的核心编排点，扇出最大（60 条边引用 10 个外部组）。

| 文件 | 复杂度 | 说明 |
|---|---|---|
| `src/chat/chat-service.ts` | complex | **核心中枢** — 管理消息历史、工具/MCP/技能/权限/Hook/团队/任务的协调 |
| `src/chat/context-builder.ts` | moderate | 构建发送给 LLM 的上下文对象 |
| `src/chat/history.ts` | moderate | 对话历史持久化（读写 JSONL） |
| `src/chat/recovery.ts` | moderate | 会话恢复逻辑 |
| `src/agent/loop.ts` | complex | **ReAct 循环** — 调用模型→解析响应→执行工具→回灌结果→再次调用 |
| `src/agent/types.ts` | simple | Agent 相关类型定义 |
| `src/agent/plan-mode.ts` | moderate | Plan Mode 两段式工作流（先制定计划再逐步执行） |
| `src/agent/sub-agent-runner.ts` | complex | 子 Agent 创建与隔离执行，集成 Worktree 隔离 |
| `src/agent/agent-tool.ts` | moderate | Agent 作为工具的封装 |
| `src/agent/tool-filter.ts` | simple | 子 Agent 工具白名单过滤 |
| `src/agent/tool-scheduler.ts` | moderate | 工具调用调度与并发控制 |
| `src/agent/task-manager.ts` | moderate | 任务管理（创建/列表/更新/状态跟踪） |
| `src/agent/task-executor.ts` | moderate | 任务执行器 |
| `src/skill/loader.ts` | complex | Skill 文件扫描与加载（builtin/user/project 三层） |
| `src/skill/registry.ts` | moderate | Skill 注册与激活管理 |
| `src/skill/activator.ts` | moderate | Skill 按名/意图匹配与激活 |
| `src/skill/types.ts` | simple | Skill 系统类型定义 |
| `src/team/team-manager.ts` | moderate | 多 Agent 团队协调，消息邮箱 + 共享任务板 |
| `src/team/lead-orchestrator.ts` | complex | Team Leader 编排：目标分解→任务分配→成果合并 |
| `src/team/team-tools.ts` | moderate | 团队协作工具集（任务 CRUD、消息、审批、停止） |
| `src/team/mailbox-system.ts` | moderate | Agent 间消息邮箱 |
| `src/team/member-backend.ts` | moderate | 团队成员后端进程 |
| `src/team/shared-task-board.ts` | moderate | 共享任务板 |
| `src/team/types.ts` | simple | Team 系统类型定义 |
| `src/bootstrap/*.ts` | moderate | 会话引导相关模块 |

### 3. 工具系统层（11 文件）

工具定义、注册、执行与过滤，是 AI 操作文件系统的能力边界。

| 文件 | 复杂度 | 说明 |
|---|---|---|
| `src/tool/types.ts` | simple | **全项目 fanIn 最高的文件（41）**— 定义 Tool、ToolResult 等核心类型 |
| `src/tool/registry.ts` | simple | 工具注册与查找 |
| `src/tool/parser.ts` | moderate | 工具调用的 XML/结构化解析 |
| `src/tool/executor.ts` | moderate | 工具调用执行器 |
| `src/tool/enhanced-executor.ts` | moderate | 增强执行器（含并发/超时/重试） |
| `src/tool/call-validator.ts` | simple | 工具调用参数校验 |
| `src/tool/permission.ts` | simple | 工具级权限控制 |
| `src/tool/tools/read-file.ts` | moderate | 文件读取工具 |
| `src/tool/tools/write-file.ts` | moderate | 文件写入工具 |
| `src/tool/tools/edit-file.ts` | complex | 精确字符串替换编辑 + diff 预览 |
| `src/tool/tools/run-command.ts` | moderate | 命令执行工具 |

### 4. LLM 集成层（12 文件）

大语言模型提供商适配与 MCP 协议客户端。

| 文件 | 复杂度 | 说明 |
|---|---|---|
| `src/provider/types.ts` | moderate | LLM Provider 类型定义与接口 |
| `src/provider/factory.ts` | moderate | Provider 工厂 — 动态创建 Anthropic/OpenAI 实例 |
| `src/provider/anthropic.ts` | complex | Anthropic Messages API 流式适配（extended thinking、工具调用） |
| `src/provider/openai.ts` | moderate | OpenAI Chat Completions API 适配 |
| `src/provider/sse.ts` | complex | SSE 流解析 — 统一 Anthropic/OpenAI 不同事件格式 |
| `src/provider/llm.ts` | simple | LLM 模块入口 |
| `src/mcp/manager.ts` | moderate | MCP 服务器生命周期管理 |
| `src/mcp/client.ts` | moderate | MCP 协议客户端 |
| `src/mcp/config.ts` | moderate | MCP 配置加载（从 codia.yaml） |
| `src/mcp/json-rpc.ts` | moderate | JSON-RPC 消息处理 |
| `src/mcp/transport.ts` | moderate | MCP 传输层（stdio/HTTP） |
| `src/mcp/adapter.ts` | simple | MCP 工具到 Codia Tool 的适配转换 |
| `src/mcp/types.ts` | simple | MCP 协议类型定义 |

### 5. 核心服务层（41 文件）

上下文管理、Prompt 构建、Hook、权限、记忆、指令、配置、Worktree 等横切关注点。

**上下文管理：**

| 文件 | 复杂度 | 说明 |
|---|---|---|
| `src/context/context-manager.ts` | complex | 上下文管理器 — 协调压缩策略与 token 预算 |
| `src/context/heavy-compressor.ts` | complex | 重量级压缩 — 通过 LLM 生成结构化五部分摘要 |
| `src/context/light-compressor.ts` | moderate | 轻量级压缩 — 截断工具结果 |
| `src/context/token-counter.ts` | moderate | Token 计数估算 |
| `src/context/index.ts` | simple | Context 模块 barrel 导出 |

**Prompt 构建：**

| 文件 | 复杂度 | 说明 |
|---|---|---|
| `src/prompt/builder.ts` | moderate | System Prompt Builder — 按优先级拼接 Section |
| `src/prompt/sections.ts` | complex | 系统指令段落集合（角色、工具说明、安全规则等） |
| `src/prompt/bootstrap-sections.ts` | moderate | 启动引导段落（项目指令、记忆索引） |
| `src/prompt/system-prompt.ts` | moderate | System Prompt 组装入口 |
| `src/prompt/reminders.ts` | moderate | 系统提醒消息生成 |

**安全与权限：**

| 文件 | 复杂度 | 说明 |
|---|---|---|
| `src/permission/checker.ts` | moderate | **五层决策链** — 默认允许→用户确认→规则匹配→路径沙箱→黑名单 |
| `src/permission/rule-engine.ts` | moderate | 四层规则引擎（glob + YAML 持久化） |
| `src/permission/path-sandbox.ts` | moderate | 文件路径越界检测 |
| `src/permission/blocklist.ts` | simple | 危险命令正则黑名单 |
| `src/permission/mode-evaluator.ts` | simple | 四种权限模式→行为映射 |
| `src/core/security/*.ts` | moderate | 命令消毒、沙箱、注入检测、URL 消毒等 |

**Hook、记忆、指令、Worktree：**

| 文件 | 复杂度 | 说明 |
|---|---|---|
| `src/hook/engine.ts` | moderate | Hook 引擎 — PreToolUse/PostToolUse 等事件钩子 |
| `src/hook/loader.ts` | moderate | Hook 规则加载（三层配置合并） |
| `src/hook/executor.ts` | moderate | Hook 动作执行 |
| `src/hook/matcher.ts` | simple | Hook 条件匹配 |
| `src/memory/store.ts` | complex | 分层记忆存储 — 项目规范/用户偏好/会话经验 |
| `src/memory/extractor.ts` | complex | 记忆提取 — 从对话中通过 LLM 提炼可复用记忆 |
| `src/instruction/loader.ts` | moderate | 项目指令加载与缓存 |
| `src/instruction/resolver.ts` | complex | 指令引用展开（@include，防越权） |
| `src/worktree/manager.ts` | moderate | Git Worktree 管理 — 创建/切换/清理 |
| `src/worktree/initializer.ts` | moderate | Worktree 初始化与钩子设置 |
| `src/worktree/creator.ts` | moderate | Worktree 创建 |
| `src/worktree/cleaner.ts` | simple | Worktree 清理 |
| `src/worktree/git-ops.ts` | moderate | Git 操作封装（可注入接口） |
| `src/worktree/path-validator.ts` | simple | 路径安全校验 |
| `src/config/index.ts` | moderate | 配置加载入口（YAML + 环境变量 + 默认值） |

### 6. 测试层（64 文件）

`src/__tests__/` 下覆盖所有模块的单元/集成测试。每个生产模块都有对应的测试文件，形成完整的 tested_by 链路。

### 7. 文档层（63 文件）

`docs/` 下 14 个功能模块的四件套（spec → plan → task → checklist），遵循 spec 驱动开发流程。另有项目级文档（README、AGENTS、CLAUDE）和 Skill 内置定义。

### 8. 项目配置层（9 文件）

`package.json`、`tsconfig.json`、`vitest.config.ts`、`codia.yaml`、`.codia/permissions.local.yaml` 等构建和运行配置。

---

## 三、核心设计模式与概念

| 模式 | 应用位置 | 说明 |
|---|---|---|
| **ReAct 循环** | `agent/loop.ts` | Reasoning + Acting：调用模型→解析→执行工具→回灌→循环 |
| **工厂模式** | `provider/factory.ts` | 根据配置动态创建 Anthropic/OpenAI Provider |
| **适配器模式** | `mcp/adapter.ts`, `provider/sse.ts` | MCP 工具适配 Codia Tool 接口；SSE 事件格式统一 |
| **Builder 模式** | `prompt/builder.ts` | Section 按优先级拼接为 System Prompt |
| **策略模式** | `context/context-manager.ts` | 上下文压缩：轻量截断/重量 LLM 摘要 |
| **责任链** | `permission/checker.ts` | 五层权限编排：默认→确认→规则→沙箱→黑名单 |
| **依赖注入** | `worktree/` | GitWorktreeOps 接口 + Real/Mock 实现，便于测试 |
| **三层配置合并** | `hook/loader.ts`, `skill/loader.ts` | global → user → project 优先级覆盖 |
| **Worktree 隔离** | `worktree/manager.ts` | 为子 Agent 创建独立 git worktree，防冲突 |
| **记忆分层** | `memory/store.ts` | project/user/ad-hoc 三层记忆持久化 |

---

## 四、新人学习路线（12 步导览）

1. **项目概览** — 阅读 `README.md` 和 `AGENTS.md`，了解定位与开发规范
2. **CLI 入口** — 从 `bin/codia.tsx` 看启动流程：参数解析→配置加载→会话管理→ChatService
3. **配置与界面** — 看 `src/config/index.ts`（配置层）和 `src/tui/app.tsx`（TUI 主组件）
4. **对话服务** — 重点读 `src/chat/chat-service.ts`（中枢协调器，fanOut=51）
5. **Agent 循环** — 核心：`src/agent/loop.ts` ReAct 循环 + plan-mode.ts 两段式工作流
6. **工具系统** — 从 `src/tool/types.ts`（fanIn=41）开始，再看 registry、executor 和各个工具
7. **命令系统** — `src/command/` 下的 parser→dispatcher→registry + 内置命令
8. **技能系统** — `src/skill/` 三层技能加载→注册→激活流程
9. **LLM 与 MCP** — Provider 工厂→Anthropic 适配→SSE 解析→MCP 协议
10. **Prompt 管线** — builder 按优先级拼接 sections，生成 Agent 的「思维框架」
11. **安全层** — 权限五层链 + Hook 引擎 + 上下文压缩
12. **高级特性** — Worktree 隔离 + 记忆系统 + 多 Agent 团队协作

---

## 五、复杂度热点（需谨慎接触的区域）

以下文件复杂度为 `complex`，是系统中最密集、最关键的代码所在：

| 文件 | 层级 | 难点 |
|---|---|---|
| `src/chat/chat-service.ts` | Agent 执行层 | 协调器：51 个扇出，集成 10+ 子系统 |
| `src/agent/loop.ts` | Agent 执行层 | ReAct 循环：工具调度、上下文压缩、Hook 生命周期 |
| `src/agent/sub-agent-runner.ts` | Agent 执行层 | 子 Agent 隔离执行 + Worktree + 工具过滤 |
| `src/team/lead-orchestrator.ts` | Agent 执行层 | 目标分解→分配→合并→冲突回滚 |
| `src/skill/loader.ts` | Agent 执行层 | 三层扫描 + YAML frontmatter + 目录遍历 |
| `src/tool/tools/edit-file.ts` | 工具系统层 | 精确字符串替换 + diff + 上下文校验 |
| `src/provider/anthropic.ts` | LLM 集成层 | Anthropic 特有：extended thinking、content block、错误映射 |
| `src/provider/sse.ts` | LLM 集成层 | 两种 API 格式统一为内部 Chunk 类型 |
| `src/context/heavy-compressor.ts` | 核心服务层 | LLM 摘要压缩：切分、五部分 prompt、熔断机制 |
| `src/memory/extractor.ts` | 核心服务层 | 从对话中提炼可复用记忆（需要 LLM 调用） |
| `src/memory/store.ts` | 核心服务层 | 分层记忆：索引/Markdown 读写/去重 |
| `src/instruction/resolver.ts` | 核心服务层 | @include 递归展开 + 路径白名单防越权 |
| `src/prompt/sections.ts` | 核心服务层 | 系统指令段落集合，直接影响模型行为 |

---

## 六、开发约定

来自 `AGENTS.md`：

- **语言**：中文注释，中文回答
- **测试**：vitest 写单元/集成测试，`pnpm test` 全部通过才算完成
- **E2E**：由开发者手动测试，AI 提供 checklist
- **Git**：每次功能完成后必须 git commit
- **Spec 流程**：使用 `/codia-spec` 走 spec → plan → task → checklist 四文档流程
