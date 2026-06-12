# 提示词管线 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性
- [ ] `src/prompt/types.ts` 存在，导出 Section、SystemReminder、ReminderProvider 类型（验证：`pnpm exec tsc --noEmit` 编译通过）
- [ ] `SystemPromptBuilder` 可构造、add section、build 输出文本（验证：运行 T12 测试）
- [ ] 七个 section 函数均返回非空 Section 对象（验证：运行 T13 测试）
- [ ] `wrapReminder` 输出含 `<system-reminder>...</system-reminder>` 标签（验证：运行 T14 测试）
- [ ] `reminderToMessage` 生成 role=user 的消息（验证：运行 T14 测试）
- [ ] 工具列表通过 API `tools` 参数传递，不拼入 system prompt（验证：检查 AnthropicProvider.buildRequestBody 返回的 system 文本不含工具描述，工具描述仅在 body.tools 中）

## 集成
- [ ] `ChatService` 使用 `SystemPromptBuilder` 构造 system prompt，不再硬编码（验证：`pnpm test` 全部通过）
- [ ] 环境信息通过 `<system-reminder>` 注入，不出现在 system prompt 中（验证：检查 build() 输出无运行时变量）
- [ ] Plan mode 首轮注入完整提示，后续轮次注入简短标签（验证：运行 T14 测试）
- [ ] Anthropic provider 将 system prompt 放入 `body.system` 字段（验证：运行 T8 相关测试）
- [ ] OpenAI provider 将 system prompt 拼为 messages 头部 role=system 消息（验证：运行 T9 相关测试）
- [ ] AgentLoop 每轮调用 getReminders 并注入消息到对话历史末尾（验证：运行 T10 相关测试）

## 编译与测试
- [ ] `pnpm exec tsc --noEmit` 编译无错误
- [ ] `pnpm test` 全部通过（含已有测试和新测试）

## 规则强化
- [ ] `read_file` description 含 "编辑文件前必须先用本工具读取"
- [ ] `edit_file` description 含 "调用前必须先用 read_file 读取"
- [ ] `write_file` description 含 "覆盖前必须先用 read_file 确认"
- [ ] `glob` description 含 "优先用本工具而非 ls 或 find"
- [ ] `grep` description 含 "优先用 codegraph_search"
- [ ] `run_command` description 含 "优先使用专用工具"

## 端到端场景
- [ ] **场景 1 — 普通模式首次对话：** 启动对话，`/help` 问候。验证：(a) 模型自我介绍为 Codia CLI 编程助手；(b) 具备工具列表（非 plan mode 受限）
- [ ] **场景 2 — Plan Mode 完整流程：** `/plan 实现一个新工具` → 验证模型只读探索代码 → 输出计划 → `/do` → 验证退出 plan mode 后可执行修改操作
- [ ] **场景 3 — 缓存命中观测：** 在同一会话连续发送两条消息，通过日志/调试输出观测第二次请求的 `cache_read_input_tokens > 0`（需 Anthropic API）
