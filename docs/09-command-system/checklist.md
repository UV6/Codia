# 命令注册与分发机制 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] CommandParser 可解析斜杠命令（验证：`parseCommand("/help")` 返回 `{ isCommand: true, name: "help", args: "" }`）
- [ ] CommandParser 可识别非命令输入（验证：`parseCommand("hello")` 返回 `{ isCommand: false }`）
- [ ] CommandParser 大小写不敏感（验证：`parseCommand("/Help")` name 为 `"help"`）
- [ ] CommandRegistry 注册十条内置命令成功（验证：`registry.getAll().length === 10`）
- [ ] CommandRegistry 注册同名命令时 throw（验证：两次 register 同名 CommandDef 抛出异常）
- [ ] CommandRegistry 别名冲突时 throw（验证：register cmd1 alias "x"，再 register cmd2 alias "x" 抛出异常）
- [ ] CommandRegistry 按别名查找到命令（验证：注册别名为 "h" 的命令后，`get("h")` 返回该命令）
- [ ] CommandDispatcher local 型命令直接执行 handler（验证：mock UIContext，handler 被调用）
- [ ] CommandDispatcher ui 型命令直接执行 handler（验证：mock UIContext，handler 被调用）
- [ ] CommandDispatcher prompt 型命令调用 sendUserMessage（验证：mock UIContext，sendUserMessage 被调用且收到提示词文本）
- [ ] StatusBar 显示模式标记（验证：mode="plan" 时渲染 `[PLAN]`，mode="full" 时渲染 `[DEFAULT]`）
- [ ] InputBox Tab 单匹配自动补全（验证：输入 `/hel` 按 Tab 后变为 `/help`）
- [ ] InputBox Tab 多匹配展示候选列表（验证：输入 `/p` 按 Tab 后展示可选命令列表）
- [ ] UIContext.clearMessages 清空消息列表（验证：`/clear` 后界面消息全部消失）
- [ ] UIContext.triggerCompact 触发上下文压缩（验证：`/compact` 后压缩事件被触发）
- [ ] UIContext.sendUserMessage 绕过命令分流（验证：prompt 型命令注入的文本不再被 parseCommand 二次解析）
- [ ] ChatService.sendMessage 不再包含命令检测逻辑（验证：代码中无 isPlanCommand/isCompressCommand 等调用）

## 集成

- [ ] App 启动时注册全部十条内置命令（验证：`registry.getAll().length === 10`）
- [ ] handleSubmit 中 `/` 开头输入走命令分发（验证：输入 `/clear` 不触发 AI 调用）
- [ ] handleSubmit 中非 `/` 开头输入走 AI 对话（验证：输入 `你好` 进入 AgentLoop）
- [ ] 未知命令显示 /help 引导（验证：输入 `/foo` 显示提示信息）
- [ ] /plan 后 StatusBar 显示 [PLAN]（验证：输入 `/plan`，观察状态栏变化）
- [ ] /do 后 StatusBar 显示 [DEFAULT]（验证：输入 `/do`，观察状态栏变化）
- [ ] UIContext 桥接正确（验证：prompt 型命令通过 sendUserMessage 注入的消息能正常进入 AI 对话）

## 编译与测试

- [ ] `pnpm exec tsc --noEmit` 编译无错误
- [ ] `pnpm test` 所有测试通过（包括新增的命令系统测试和已有测试）

## 端到端场景

- [ ] 场景 1：启动 → `/help` 列出所有命令 → 选择 `/plan 实现登录` → 状态栏变 [PLAN] → AI 进入计划模式分析需求
- [ ] 场景 2：输入 `/clear` 清空界面 → 输入 `实现一个工具函数` → 正常进入 AI 对话
- [ ] 场景 3：输入 `/hel` 按 Tab → 自动补全为 `/help` → 回车执行 → 看到命令列表
- [ ] 场景 4：计划模式中输入 `/do` → 状态栏变回 [DEFAULT] → 后续对话恢复正常全能力模式
- [ ] 场景 5：输入 `/status` 回车 → 显示 token 用量、模型、模式等状态信息，不调用 AI
- [ ] 场景 6：输入 `/session` 回车 → 显示当前会话路径和消息数，不调用 AI
- [ ] 场景 7：输入 `/memory` 回车 → 显示记忆存储状态，不调用 AI
- [ ] 场景 8：输入 `/compact` 回车 → 触发上下文压缩，不调用 AI
- [ ] 场景 9：输入 `/permission` 回车 → 显示当前权限模式，不调用 AI
- [ ] 场景 10：输入 `/review` 回车 → 注入代码审查提示词，调用 AI 进行审查
- [ ] 场景 11：输入非 `/` 开头文本（如 `hello`）按 Tab → 不触发命令补全
