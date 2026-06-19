# Skill 系统 Spec

## 背景

Codia 当前已有命令系统（`/help`、`/session` 等）和指令系统（MEWCODE.md 三层加载），但二者各有限制：
- 命令系统只能执行简单 handler 或发送固定 prompt 文本，无法承载复杂的多步 AI 操作
- 指令系统是静态的背景知识，无法按需激活、无法控制工具可见性、无法切换执行模式

用户在日常使用中会反复输入相似的提示词（如"帮我提交代码"、"review 这个变更"），每次都要重新描述流程，效率低且一致性差。

## 目标

将可复用的 AI 操作封装为 **Skill**——带元信息的 Markdown 文件，支持两阶段加载和两种执行模式，让用户一键触发标准化的 AI 工作流。

## 功能需求

### 定义与存储

- **F1: Skill 文件格式** — 单个 Skill 用 YAML frontmatter + Markdown 正文描述。frontmatter 包含元信息（name、description、allowedTools、mode 等），正文是发给模型的 SOP 指令，支持 `{{placeholder}}` 参数占位符。
- **F2: 单文件与目录型两种形式**
  - 单文件：一个 `skill-name.md` 即一个 Skill。
  - 目录型：一个目录内含入口 `skill.md` + 专属资源子目录（`reference/`、`script/`、`example/` 等），整套作为一个能力包分发和加载。入口文件仍为 Markdown + YAML frontmatter。
  - 同一目录下同时存在 `name.md`（单文件）和 `name/skill.md`（目录型）时，目录型优先。
- **F3: 三级存放与优先级覆盖** — Skill 存放在三层目录：内置（`<codia>/skills/builtin/`）、用户（`~/.codia/skills/`）、项目（`<project>/.codia/skills/`）。同名 Skill 按优先级覆盖：项目 > 用户 > 内置。
- **F4: 解析容错** — 单个 Skill 文件解析失败时跳过并输出诊断警告，不阻断其他 Skill 的加载。

### 两阶段加载

- **F5: 阶段一（启动摘要）** — 启动时扫描三级目录，只解析 frontmatter 中的 name 和 description，将所有可用 Skill 的摘要注入对话上下文（不加载正文）。
- **F6: 阶段二（按需激活）** — 提供内置系统工具 `LoadSkill`。激活方式有两种：
  - **显式调用**：用户输入 `/skill-name`，走命令路由触发 LoadSkill。
  - **意图识别**：Agent 根据当前任务需要，自行调用 LoadSkill 加载所需 Skill。
  LoadSkill 加载完整指令正文及目录型 Skill 的附属资源。
- **F7: 激活后上下文钉住** — 已激活 Skill 的完整指令钉在环境上下文最显眼的位置，每轮对话重建时都在。多个 Skill 可同时激活，各自内容依次展示。
- **F8: Skill 间相互调用** — 一个已激活的 Skill 可以调用另一个 Skill（通过 LoadSkill），实现组合工作流。
- **F9: 热更新** — Skill 源文件变更后，通过 LoadSkill 重新加载同名 Skill 即可覆盖已激活版本，无需重启进程。
- **F10: 会话清空时清除激活** — 用户清空对话时，已激活的 Skill 一并清除。

### 工具白名单

- **F11: allowedTools 收窄工具** — 每个 Skill 的 frontmatter 中用 `allowedTools` 声明可见工具白名单。Skill 激活后，当前可用工具被收窄为白名单中的工具。
- **F12: 启动校验** — 启动时校验所有 Skill 的 allowedTools 中引用的工具名在系统内置工具注册表中是否存在，不存在立即报错。MCP 工具因异步注册，启动时不做校验（仅校验内置工具）。
- **F13: LoadSkill 不受白名单约束** — LoadSkill 是系统级工具，不受任何 allowedTools 约束，始终可用且所有工具对其可见。

### 执行模式

- **F14: Inline 模式** — 共享当前对话上下文，执行结果留在主对话历史中。适合轻量操作。
- **F15: Fork 模式** — 开启独立对话上下文执行 Skill（新 Agent 实例 + 独立 Message[]），执行完毕后摘要以 tool result 形式写回主对话。可配置带入历史轮数。上下文隔离由 Agent 架构保证，不需要进程级隔离。
- **F16: 模式声明** — 每个 Skill 在 frontmatter 中用 `mode: inline | fork` 声明模式，调用时自动按其声明执行。

### 命令注册

- **F17: 自动注册斜杠命令** — 每个 Skill 自动注册为 `/skill-name` 斜杠命令。Skill frontmatter 可声明 `aliases` 字段，自动生成别名命令（如 `cr` → `/cr`）。
- **F18: 参数传递** — 用户调用 `/skill-name arg1 arg2` 时，参数自动替换正文中 `{{arg1}}` 等占位符。

### 内置样板

- **F19: 内置 commit Skill（inline）**
  - 流程：`git status` → `git diff` + `git diff --staged` → 分析变更 → 生成 conventional commit message → 逐文件 `git add`（不用 `git add -A`）→ `git commit`
  - 变更超过 10 个文件时主动建议拆分为多个提交

- **F20: 内置 review Skill（fork）**
  - Fork 模式，切断自我认同，在隔离上下文中做客观审查
  - 五个审查维度：逻辑正确性、安全性、性能、代码风格、可维护性
  - 严重程度分级：Critical / Warning / Info

- **F21: 内置 test Skill（inline）**
  - 流程：检测项目类型 → 运行测试 → 分析输出
  - 关键能力：区分代码 bug 导致的失败 vs 测试本身写错导致的失败
  - 全部通过时报告覆盖率和可能的遗漏场景

## 非功能需求

- **N1: 加载性能** — 阶段一扫描不应显著增加启动时间。Skill 总量在 100 个以内时，扫描耗时 < 50ms。
- **N2: 激活性能** — LoadSkill 激活单个 Skill 耗时 < 20ms。
- **N3: 上下文效率** — 阶段一注入的摘要应紧凑，每个 Skill 约 1 行，不额外撑大 prompt。
- **N4: 诊断可追溯** — 解析错误、白名单缺失等诊断信息包含：来源文件路径、错误级别（error/warning）、具体原因。
- **N5: 与现有系统集成** — 斜杠命令复用 `src/command/` 的路由和解析机制；目录型 Skill 的附属文件访问复用现有文件系统抽象。

## 不做的事

- 不做 Skill 市场分发（远程下载、版本依赖解析、发布/上传）
- 不做 Skill 版本管理（版本号、升级/降级/锁定版本）
- 不做 Skill 共享/协作（团队同步、权限控制、使用统计）
- 不做图形化 Skill 编辑器
- 不做 Skill 执行沙箱（Fork 模式复用现有 Agent loop，不额外实现进程隔离或容器化）

## 验收标准

### 定义与存储
- **AC1:** 将一个合法 Skill 文件放入三层目录任一层，启动后能在可用 Skill 列表中看到其名字和说明。
- **AC2:** 同名 Skill 同时存在于项目和用户目录时，项目版本生效。
- **AC3:** 一个 frontmatter 格式错误的 Skill 文件不阻断其他正常 Skill 的加载，且诊断输出包含该文件路径和错误原因。
- **AC4:** 目录型 Skill 的 `reference/`、`script/` 下文件在 LoadSkill 后可被 Agent 访问。

### 两阶段加载
- **AC5:** 启动后，未激活任何 Skill 时，Agent 仅可见 Skill 的 name 和 description，不可见 SOP 正文。
- **AC6:** Agent 调用 LoadSkill 后，Skill 正文出现在后续上下文中，内容与源文件一致（含参数替换）。
- **AC7:** 同时激活两个 Skill 后，两者的正文均在上下文中可见。
- **AC8:** Agent 根据任务描述自行调用 LoadSkill 加载匹配的 Skill（意图识别），无需用户显式输入斜杠命令。
- **AC9:** 清空对话后，已激活 Skill 不再出现在上下文中。
- **AC10:** 修改 Skill 源文件后重新加载，获得新内容。

### 工具白名单
- **AC11:** allowedTools 为 `["Bash", "Read"]` 的 Skill 激活后，Agent 只能调用 Bash、Read 及 LoadSkill。
- **AC12:** 启动时某 Skill 的 allowedTools 引用了不存在的工具名，诊断输出指明 Skill 名和工具名。

### 执行模式
- **AC13:** Inline 模式 Skill 执行后，中间交互留在主对话历史中。
- **AC14:** Fork 模式 Skill 执行后，主对话仅出现执行摘要，不包含中间交互。
- **AC15:** Fork 模式带入指定历史轮数后，fork 上下文中可见带入的消息。

### 命令注册
- **AC16:** 将 `my-skill.md` 放入 Skill 目录后，输入 `/my-skill` 自动加载并执行。
- **AC17:** `/my-skill hello world` 中 `hello` 替换正文中的 `{{arg1}}`，`world` 替换 `{{arg2}}`。

### 内置 Skill
- **AC18:** `/commit` 执行：分析变更 → 生成规范 commit message → 逐文件 add → commit。
- **AC19:** `/review` 在 fork 模式执行，输出按五维度分级的审查报告。
- **AC20:** `/test` 执行：运行测试 → 区分失败类型 → 全绿时报告覆盖率和遗漏场景。
