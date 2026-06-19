# Agent 系统 Spec

## 背景

Codia 当前的主 Agent Loop（`src/agent/loop.ts`）是单进程、单上下文的 ReAct 循环。所有工具调用、权限检查、上下文管理都跑在同一个对话中。这带来三个问题：

1. **上下文污染**：子任务（如代码审查、测试生成）的结果混入主对话历史，随对话增长挤占 token 预算、稀释主任务的注意力
2. **无独立上下文**：每个子任务共享同一套消息历史、文件读缓存、权限状态、token 计数——无法为不同任务分配不同的工具集或权限模式
3. **已有轮子但不够**：`src/skill/fork.ts` 实现了一个简化版 fork，但它创建的空 AgentLoop 没有 Hook 引擎、权限检查、上下文压缩——更像是"另开一个裸循环跑一下"而非真正的子 Agent 机制

同时，Hook 系统预留了 `subagent` 动作类型但标记为"占位"，等待本章节对接。

## 目标

构建一个子 Agent 系统，让主 Agent 把子任务委派给独立执行的子 Agent，每个子 Agent 有隔离的运行时状态、受限的工具集，跑完异步通知结果，彻底解决上下文污染。

核心原则：
- **一个工具，两条路径**：通过统一的 `Agent` 工具暴露，角色名作为类型参数分流"定义式"和"Fork 式"
- **角色即配置**：Agent 行为由 Markdown + YAML frontmatter 定义，四级来源加载、按优先级覆盖
- **状态隔离，基建共享**：消息历史、权限状态、文件读缓存、token 计数各自独立；LLM 客户端、Hook 引擎、文件系统复用宿主
- **跑到底，不交互**：子 Agent 非交互执行，模型不再调工具视为完成，结果异步送回主对话
- **多层工具防线**：全局禁止 → 自定义额外禁止 → 后台白名单 → 角色定义，层层收窄，防止无限嵌套
- **三步入后台**：显式指定、超时自动切、手动切，Fork 式强制后台执行

---

## 功能需求

### F1: Agent 角色定义与加载

Agent 角色用 Markdown 文件定义，YAML frontmatter 声明元信息，正文是子 Agent 的系统提示。文件放在 `.codia/agents/` 目录体系：

```
~/.codia/agents/          # 用户级
  code-reviewer.md
  test-writer.md

$PROJECT/.codia/agents/   # 项目级
  custom-reviewer.md       # 同名覆盖用户级
```

**Frontmatter 字段**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | 唯一标识，小写字母+连字符，如 `code-reviewer` |
| `description` | 是 | 一句话用途说明 |
| `model` | 否 | `"inherit"`（默认）/ `"haiku"` / `"sonnet"` / `"opus"` |
| `maxRounds` | 否 | 最大迭代轮次，默认 20 |
| `permissionMode` | 否 | 权限模式，默认 `"bypassPermissions"` |
| `tools` | 否 | 工具白名单，缺省继承主 Agent 全部工具 |
| `disallowedTools` | 否 | 工具黑名单，在白名单基础上再剔除 |

**四级加载优先级**（同级目录按文件名排序，后者覆盖前者）：

```
项目级 > 用户级 > 插件级 > 内置角色
```

**内置角色**（无需配置文件，代码内置）：

| 角色名 | 用途 |
|--------|------|
| `Explore` | 只读代码探索，多文件搜索 |
| `Plan` | 软件架构设计，输出实现方案 |
| `general-purpose` | 通用子 Agent，无特定角色约束 |
| `Verification` | 验证代码变更是否正确 |

### F2: 统一的 Agent 工具

主 Agent 通过一个 `Agent` 工具委派子任务，工具定义始终固定在工具列表中。角色名直接作为类型参数。

**参数 schema**：

| 参数 | 必填 | 说明 |
|------|------|------|
| `subagent_type` | 否 | 角色名即为定义式（如 `"Explore"`、`"Plan"`、`"code-reviewer"`）；留空则为 Fork 式，继承父对话 |
| `description` | 是 | 简短描述（3-5 词），用于进度展示 |
| `prompt` | 是 | 委派给子 Agent 的任务描述 |
| `name` | 否 | 可选的显示名称，留空则用角色名或自动生成 |
| `model` | 否 | 可选模型覆盖，不填则用角色定义或继承父 Agent |
| `run_in_background` | 否 | 显式指定后台运行 |
| `isolation` | 否 | 隔离模式：`"worktree"` 创建独立 git worktree（本步不做，仅预留参数） |

**分流逻辑**：
- `subagent_type` 有值 → 定义式：从角色注册中心加载该角色的系统提示，空白对话启动
- `subagent_type` 为空 → Fork 式：继承父对话的完整消息历史，首次请求命中 prompt cache

### F3: 定义式子 Agent 执行

指定 `subagent_type` 角色名时的执行模式：

1. 从角色注册中心按名查找角色定义，四级优先级匹配
2. 构造空白对话（空消息列表），第一条消息为 `prompt` 参数内容
3. 注入角色的系统提示正文作为 system prompt
4. 按角色的 `tools` / `disallowedTools` 过滤可用工具
5. 执行 Agent Loop，非交互模式，模型不再调工具视为完成
6. 完成后将子 Agent 的最终文本结果返回给主 Agent

整个过程与主对话完全隔离——子 Agent 看不到主对话历史，主对话也不被子 Agent 的中间过程污染。

### F4: Fork 式子 Agent 执行

`subagent_type` 为空时的执行模式：

1. 继承主对话的完整消息历史（父 Agent 的 `messages` 数组）
2. 第一轮追加新的 user 消息作为任务描述（prompt 参数）
3. 继承父 Agent 的工具集，不做角色级工具过滤
4. 首次 LLM 请求因消息历史前缀匹配命中 prompt cache，降低 token 成本
5. 非交互执行，模型不再调工具视为完成
6. 完成后结果异步通知回主 Agent

Fork 式子 Agent **强制后台执行**（`run_in_background` 参数被忽略，始终为 true），因为它的核心价值是缓存命中省钱，不需要用户盯着。

### F5: 运行时状态隔离

子 Agent 与主 Agent 之间在以下维度隔离：

| 维度 | 隔离方式 |
|------|---------|
| 消息历史 | 独立的 `messages` 数组，定义式从空开始，Fork 式从副本开始 |
| 权限状态 | 独立的 `PermissionChecker` 实例，`always_allow` 记忆不跨 Agent |
| 文件读缓存 | 独立的读取缓存，同名文件重复读取不共享 |
| Token 计数 | 独立统计，不混入主 Agent 用量 |

以下基础设施共享（复用父进程实例，不另起）：

| 基础设施 | 共享方式 |
|---------|---------|
| LLM 客户端 | 复用父 `LLMProvider` 实例，只改 model 参数 |
| Hook 引擎 | 复用父 `HookEngine`，子 Agent 内 Hook 事件正常触发 |
| 文件系统 | 同一进程、同一工作目录 |
| 工具注册中心 | Fork 式直接复用父 ToolRegistry；定义式通过角色过滤后复用 |

### F6: 非交互执行与完成判定

子 Agent 始终以「跑到底」模式运行，生命周期为：

1. 接收任务 → 进入 Agent Loop
2. 循环：LLM 响应 → 有工具调用则执行 → 结果回灌 → 下一轮
3. 模型返回纯文本（无工具调用）→ 视为完成
4. 将最终文本收集为结果

与主 Agent 交互模式的区别：
- 不经过人在回路（权限模式始终按角色定义，默认为 `bypassPermissions`）
- 不渲染 TUI 界面
- 达到 `maxRounds` 上限时自动截断，返回"已达最大轮次"提示

完成判定：
- **正常完成**：模型返回纯文本（无 tool_use block）
- **异常完成**：stream_error、cancelled、max_rounds、unknown_tool
- 两种完成都会生成结果并通知主 Agent

### F7: 工具过滤多层防线

子 Agent 的工具集经过四层过滤，系统级先收窄，角色定义做精筛：

**第一层：全局禁止**

无论角色配置如何，以下工具子 Agent 永远不可用：
- `Agent` —— 禁止子 Agent 再创建孙 Agent，防止无限嵌套
- `AskUserQuestion` —— 子 Agent 不与用户交互
- `TaskStop` —— 子 Agent 不能终止其他人的任务

**第二层：自定义 Agent 额外禁止**

用户或项目可通过 `CUSTOM_AGENT_DISALLOWED_TOOLS` 配置额外禁止的工具列表，在此层统一剔除。这允许在所有子 Agent 之上再统一禁用某些工具，不依赖单个角色配置。

**第三层：后台白名单**

后台运行时（`run_in_background: true` 或 Fork 强制后台），工具集被进一步收窄到 `ASYNC_AGENT_ALLOWED_TOOLS` 硬编码列表。该列表仅包含纯只读、无副作用的工具，明确排除：
- `Agent`（防嵌套）
- `Task*` 系列（TaskCreate / TaskUpdate / TaskList / TaskGet）
- `SendMessage`（后台不直接发消息）

**第四层：角色定义（仅定义式）**

角色的 `tools`（白名单）和 `disallowedTools`（黑名单）在前三层结果上做精细筛选：
- `tools` 非空时，只允许白名单内的工具
- `disallowedTools` 在白名单结果上再剔除
- Fork 式跳过此层，继承父 Agent 完整工具集（但前三层仍生效）

最终工具列表为四层过滤后的交集，传给 LLM API。

### F8: 后台任务管理

子 Agent 支持三种方式进入后台执行：

| 方式 | 触发条件 |
|------|---------|
| 显式指定 | `run_in_background: true` 参数 |
| 超时自动 | 子 Agent 运行时间超过阈值（默认 120s），自动切后台 |
| 手动切换 | 用户在 TUI 中按快捷键将当前子 Agent 切到后台 |
| Fork 强制 | Fork 式子 Agent 始终后台执行，忽略 `run_in_background` 参数 |

后台任务管理器追踪以下状态：

| 字段 | 说明 |
|------|------|
| 任务 ID | 唯一标识 |
| 状态 | `running` / `completed` / `failed` |
| 子 Agent 类型 | 角色名（定义式）或 `"fork"` |
| 开始时间 | ISO 8601 |
| 结果 | 完成后的文本输出（仅在 `completed` 时有值） |
| 用量 | input/output token 统计 |

**结果通知**：

后台子 Agent 完成后，系统以 `<task-notification>` 标签将结果注入主对话的消息历史。标签携带任务 ID、状态和结果摘要，主 Agent 在下一次 LLM 请求时可见此标签，从而得知子任务已完成。

**内置任务管理工具**：

系统注册四个任务管理工具，Agent 可直接调用来查询和操作后台任务：

| 工具 | 用途 |
|------|------|
| `TaskList` | 列出当前所有后台任务及其状态 |
| `TaskGet` | 按任务 ID 获取单个任务的详细信息（含结果） |
| `TaskCreate` | 创建一个追踪条目（供系统内部使用） |
| `TaskUpdate` | 更新任务状态（标记完成/失败） |

本步不做跨会话持久化：进程重启后，内存中的后台任务记录全部丢失。

---

## 非功能需求

- **N1**: 子 Agent 启动延迟不超过 200ms（不含 LLM 首次响应时间），角色加载和消息构造应轻量
- **N2**: Fork 式子 Agent 首次请求必须命中 prompt cache（消息前缀与父 Agent 一致部分自动复用），避免重复计费
- **N3**: 子 Agent 的工具过滤计算应在 5ms 内完成，不随工具总数线性增长
- **N4**: 主 Agent Loop 被取消（Ctrl+C）时，所有正在运行的子 Agent 收到取消信号并停止
- **N5**: 子 Agent 的 token 用量独立统计，不混入主 Agent 的 usage 追踪

---

## 不做的事

- Worktree 文件隔离——子 Agent 和主 Agent 共享同一文件系统，不创建独立 git worktree（`isolation` 参数仅预留）
- 多 Agent 团队编排——不支持多个子 Agent 协同工作、互相通信、依赖编排
- 后台任务的跨会话持久化——进程重启后后台任务记录丢失，不恢复到磁盘
- 子 Agent 的实时流式输出转发——子 Agent 的中间过程不实时推送到 TUI，只接收最终结果
- 子 Agent 调用结果的自动合并——结果以通知形式呈现给主 Agent，由模型自行决定如何利用

---

## 验收标准

- **AC1 (F1)**: 在 `~/.codia/agents/` 下创建 `code-reviewer.md` 角色文件（含完整 frontmatter 和正文），启动 Codia，Agent 工具可用且角色在角色列表中可见
- **AC2 (F1)**: 在 `$PROJECT/.codia/agents/` 下创建同名 `code-reviewer.md`，加载时项目级覆盖用户级，验证最终生效的是项目级版本
- **AC3 (F2)**: 主 Agent 调用 Agent 工具，`subagent_type` 指定 `Explore`，传入 prompt，子 Agent 启动并返回结果
- **AC4 (F2)**: 主 Agent 调用 Agent 工具，`subagent_type` 留空（Fork 式），继承对话历史，首次请求命中缓存
- **AC5 (F3)**: 定义式子 Agent 看不到主对话历史（从空白开始），只看到自己的系统提示和 prompt
- **AC6 (F4)**: Fork 式子 Agent 自动后台执行，`run_in_background` 参数对 Fork 无效
- **AC7 (F5)**: 两个子 Agent 并发运行时，各自的文件读缓存和权限状态互不干扰
- **AC8 (F6)**: 子 Agent 模型返回纯文本后自动结束，不等待用户确认
- **AC9 (F6)**: 子 Agent 达到最大轮次上限时截断，返回"已达最大轮次"提示而非卡住
- **AC10 (F7)**: 在子 Agent 中调用 Agent 工具（尝试嵌套创建孙 Agent），返回错误或调用被拒绝
- **AC11 (F7)**: 自定义 Agent 额外禁用列表中配置 `Grep`，所有子 Agent 均不可见 Grep 工具
- **AC12 (F8)**: 子 Agent 在后台完成后，主对话中出现 `<task-notification>` 标签通知结果
- **AC13 (F8)**: 通过 TaskList 工具查询当前后台任务列表，能看到已完成/运行中的任务状态
