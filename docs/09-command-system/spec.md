# 命令注册与分发机制 Spec

## 背景
当前 Codia 的 /plan、/do、/compress 等命令以 if-else 链硬编码在 ChatService.sendMessage() 中，
缺乏统一管理。所有用户输入无条件进入 Agent Loop，包括清屏、查状态等不需要 AI 处理的操作，
浪费 Token 且响应慢。需要一个通用的命令注册与分发机制来统一管理斜杠命令。

## 目标
- 提供统一的命令注册中心，集中管理命令元数据和处理逻辑
- 在用户输入入口实现分流：命令走本地分发，非命令才进入 AI 对话
- 命令按执行模式分类（本地操作 / 界面状态变更 / 预设提示词注入），各走各的快速通道
- 抽取界面控制接口，解耦命令实现与具体渲染框架
- 支持别名和 Tab 补全，提升交互体验
- 内置十个高频命令覆盖日常操作

## 功能需求

### F1: 命令注册中心
- 提供 `CommandRegistry`，集中管理所有命令的元数据（名称、别名列表、描述、用法示例、类型、参数提示、处理函数）
- `register(cmd)` 在启动阶段调用，注册时检测别名冲突（包括名称与名称、名称与别名、别名与别名之间的冲突），冲突时直接 throw 使进程退出
- 提供 `get(name)` 按名称或别名查找命令（别名也映射到同一命令）
- 提供 `getAll()` 返回全部注册命令（隐藏命令除外），供帮助列表和补全使用

### F2: 命令解析器
- 识别斜杠前缀 `/`：不以 `/` 开头的输入不视为命令
- 第一个空格前为命令名，空格后为参数字符串（可为空）
- 命令名转小写，实现大小写不敏感
- 空命令名（仅输入 `/`）视为未命中，引导用户使用 /help
- 未命中已注册命令时返回 undefined，由调用方展示 /help 引导

### F3: 命令类型与执行分发
- 命令按 `CommandType` 分三类：
  - `local`：纯本地操作，不涉及界面状态变更，不产生对话（如 /help、/compact、/session、/memory、/permission、/status）
  - `ui`：影响界面状态，不产生对话（如 /clear、/plan、/do）。ui 型命令的 handler 内部可以调用 `sendUserMessage` 注入消息（如 /plan 带参数时将参数作为消息注入后切换到 plan 模式）
  - `prompt`：将预设提示词（`CommandDef.promptText`）作为用户消息注入对话，交给 AI 处理。prompt 型命令的 handler 留空，分发器直接取 `promptText` 注入
- 分发器根据类型执行不同路径：
  - `local` 直接调用处理函数，不入对话
  - `ui` 调用处理函数操作界面状态，不入对话（handler 内部可自由调用 UIContext 的任何方法，包括 sendUserMessage）
  - `prompt` 不调 handler，直接取 `cmd.promptText` 通过 `sendUserMessage` 注入对话流

### F4: 界面控制接口
- 抽取 `UIContext` 接口，定义命令与界面交互的抽象能力：
  - `showMessage(text, type)`: 显示系统消息（如 info、warning、error）
  - `sendUserMessage(text)`: 将文本作为用户消息发送给 AI，直接调用 ChatService.sendMessage() 绕过命令分流器，避免二次解析
  - `clearMessages()`: 清空聊天消息列表
  - `setMode(mode)`: 切换模式（full/plan）
  - `getMode()`: 获取当前模式
  - `getTokenUsage()`: 获取当前 token 用量
  - `triggerCompact()`: 手动触发上下文压缩
  - `refreshStatus()`: 刷新状态栏
- 命令的处理函数接收 `(args: string, ui: UIContext)` 两个参数

### F5: 状态栏模式标记
- StatusBar 显示当前模式标记：`[DEFAULT]` 或 `[PLAN]`
- 模式切换时状态栏同步更新
- 与 UIContext.setMode() 联动

### F6: 输入分流器
- 在用户回车提交的入口处（`handleSubmit`）加分流逻辑
- `/` 开头 → 解析为命令 → 走命令分发器
- 非 `/` 开头 → 保持现有行为，进入 AI 对话
- 分流器返回 boolean 表示是否已处理（命令已消费为 true，未消费为 false）

### F7: 别名与 Tab 补全
- 每条命令支持零到多个别名
- 别名与主名称等价，查找时都能命中
- Tab 补全逻辑：根据当前输入匹配已注册命令
  - 单匹配：自动补全命令名
  - 多匹配：展示匹配列表供选择
  - 隐藏命令不参与补全
- 补全不触发执行，仅填充输入框

### F8: 十个内置命令

| 命令 | 类型 | 说明 |
|------|------|------|
| /help | local | 列出所有可见命令及用法 |
| /compact | local | 手动触发上下文压缩 |
| /clear | ui | 清空聊天界面 |
| /plan | ui | 进入计划模式，可选带提示词 |
| /do | ui | 退出计划模式，回到执行模式 |
| /session | local | 查看当前会话信息 |
| /memory | local | 查看记忆存储状态 |
| /permission | local | 查看当前权限模式 |
| /status | local | 显示 token 用量、模型、模式等状态 |
| /review | prompt | 触发代码审查 |

## 非功能需求

### N1: 启动时检测冲突
- 所有命令注册完毕后，别名冲突应在进程启动阶段就暴露，而非运行时才发现
- 冲突检测覆盖：命令名之间、命令名与别名、别名与别名

### N2: 响应速度
- local 和 ui 型命令的处理函数应同步返回（或微任务级别），用户感知为即时响应
- 不与 AI 通信的命令不应产生网络延迟

### N3: 可扩展性
- 新增命令只需编写命令定义对象并调用 `registry.register()`，无需修改解析器或分发器
- 命令类型枚举和 UIContext 接口为后续 Skill 系统预留扩展空间

### N4: 框架解耦
- 命令处理函数不依赖 Ink/React 具体实现，只依赖 UIContext 接口
- 未来切换到其他渲染框架时，只需重新实现 UIContext，命令代码零改动

## 不做的事
- 用户自定义命令（留给 Skill 系统）
- 动态生成提示词（留给 Skill 系统）
- 命令级权限控制（留给 Skill 系统）
- 命令历史持久化（当前不涉及）
- 多级子命令（如 `/session clear`），当前只做一级命令
- 命令管道或链式调用

## 验收标准

### AC1: 命令注册与查找
- 启动时注册十条内置命令，全部可通过名称和别名查找
- 注册两个同名命令（或别名冲突）时抛出异常

### AC2: 命令解析
- 输入 `/help` 解析为命令名 `help`、参数为空
- 输入 `/plan 重构认证模块` 解析为命令名 `plan`、参数 `重构认证模块`
- 输入 `/Help` 解析为命令名 `help`（大小写不敏感）
- 输入 `hello` 不被识别为命令
- 仅输入 `/` 引导用户使用 /help

### AC3: 命令分发
- `/help`（local 型）列出所有命令，不调用 AI
- `/clear`（ui 型）清空界面，不调用 AI
- `/review`（prompt 型）将审查提示词注入对话，调用 AI

### AC4: 分流器
- 输入 `/clear` → 走命令分发，不入 AgentLoop
- 输入 `帮我写一个函数` → 走 AI 对话路径

### AC5: /plan 与 /do 联动状态栏
- `/plan` 后状态栏显示 `[PLAN]`
- `/do` 后状态栏显示 `[DEFAULT]`

### AC6: 别名
- 为某命令设置别名后，用别名输入也能命中

### AC7: Tab 补全
- 输入 `/hel` 按 Tab → 自动补全为 `/help`
- 输入 `/p` 按 Tab → 展示 `/plan`、`/permission` 供选择

### AC8: 不调用 AI 的命令不消耗 Token
- `/help`、`/clear`、`/status` 等 local/ui 命令不产生 API 调用
