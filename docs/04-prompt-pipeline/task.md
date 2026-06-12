# 提示词管线 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/prompt/types.ts` | Section、SystemReminder、ReminderProvider 类型定义 |
| 新建 | `src/prompt/builder.ts` | SystemPromptBuilder 类 |
| 新建 | `src/prompt/sections.ts` | 七个固定 Section 函数 |
| 新建 | `src/prompt/reminders.ts` | SystemReminder 包装、EnvInfoProvider、PlanModeReminderProvider |
| 新建 | `src/prompt/index.ts` | 导出聚合 |
| 修改 | `src/provider/types.ts` | LLMProvider.streamChat 添加 systemPrompt 参数 |
| 修改 | `src/provider/anthropic.ts` | 使用 systemPrompt 参数，不再从 messages 分离 system |
| 修改 | `src/provider/openai.ts` | 使用 systemPrompt 参数拼为 system role 消息 |
| 修改 | `src/agent/loop.ts` | 接收 systemPrompt + reminders 回调，每轮注入 |
| 修改 | `src/chat/chat-service.ts` | 使用 SystemPromptBuilder + ReminderProvider |
| 修改 | `src/tool/tools/read-file.ts` | description 末尾加提醒 |
| 修改 | `src/tool/tools/edit-file.ts` | description 末尾加提醒 |
| 修改 | `src/tool/tools/write-file.ts` | description 末尾加提醒 |
| 修改 | `src/tool/tools/glob.ts` | description 末尾加提醒 |
| 修改 | `src/tool/tools/grep.ts` | description 末尾加提醒 |
| 修改 | `src/tool/tools/run-command.ts` | description 末尾加提醒 |
| 新建 | `src/__tests__/prompt/builder.test.ts` | builder 单元测试 |
| 新建 | `src/__tests__/prompt/sections.test.ts` | sections 单元测试 |
| 新建 | `src/__tests__/prompt/reminders.test.ts` | reminders 单元测试 |

## T1: 创建 `src/prompt/types.ts` — 核心类型定义

**文件：** `src/prompt/types.ts`
**依赖：** 无
**步骤：**
1. 定义 `Section` 接口：`name: string`、`priority: number`、`content: string`
2. 定义 `SystemReminder` 接口：`source: string`、`content: string`、`round: number`
3. 定义 `ReminderProvider` 类型：`(round: number) => SystemReminder[]`

**验证：** `pnpm exec tsc --noEmit` 编译通过

## T2: 创建 `src/prompt/builder.ts` — SystemPromptBuilder 类

**文件：** `src/prompt/builder.ts`
**依赖：** T1
**步骤：**
1. 实现 `SystemPromptBuilder` 类，内部持有一个 `Section[]`
2. `add(section)`：追加 section，自动按 priority 升序排序
3. `set(section)`：按 name 替换已存在的 section，不存在则追加
4. `build()`：按 priority 顺序拼接所有 section 的 content，模块间两个空行分隔
5. `debug()`：返回各模块 name、priority、content 长度的摘要字符串

**验证：** 构造 builder，add 3 个 section，build() 输出按 priority 排序、空行分隔

## T3: 创建 `src/prompt/sections.ts` — 七个固定模块内容

**文件：** `src/prompt/sections.ts`
**依赖：** T1
**步骤：**
1. 实现七个导出函数，每个返回一个 `Section`：

| 函数 | priority | 核心内容 |
|------|----------|---------|
| `identitySection()` | 1 | "你是 Codia，一个终端 AI 编程助手。用 TypeScript 实现。" 能力边界说明 |
| `constraintsSection()` | 2 | 不猜测、不假设、先问再做、表面取舍 |
| `taskModeSection()` | 3 | 目标驱动执行、定义成功标准、循环直到验证通过 |
| `actionSection()` | 4 | 编辑前必读文件、只改相关代码、匹配已有风格 |
| `toolUseSection()` | 5 | 优先用专用工具而非 Bash cat/sed/echo、codegraph 优先于 grep |
| `toneSection()` | 6 | 中文回答、简洁、无道歉套话 |
| `outputSection()` | 7 | 使用 `file:line` 格式引用代码、禁止冗余输出 |

2. 每个 section 的 content 写完整文本，2-5 句，清晰不冗长
3. 关键规则（"编辑前必先读"、"优先用专用工具"）在对应 section 中明确写出

**验证：** 调用每个函数，确认返回的 Section 对象 name、priority、content 非空

## T4: 创建 `src/prompt/reminders.ts` — SystemReminder 注入

**文件：** `src/prompt/reminders.ts`
**依赖：** T1
**步骤：**
1. 实现 `wrapReminder(reminder: SystemReminder): string` — 输出 `<system-reminder>\n<内容>\n</system-reminder>`
2. 实现 `reminderToMessage(reminder: SystemReminder): Message` — 输出 `{role:"user", content: wrapReminder(reminder), timestamp: now}`
3. 实现 `createEnvInfoProvider(): ReminderProvider` — 返回一个闭包，每次调用收集 `cwd`、`platform`、`shell`、`date`、git 分支名、最近 3 条 commit、未提交变更摘要，只在 round=0 时返回非空数组
4. 实现 `PlanModeReminderProvider` 类：
   - 构造函数接收 `planFilePath: string`、`planModePrompt: string`（即现有的 `PLAN_MODE_PROMPT`）
   - `activate(round)`: 标记进入 plan mode
   - `deactivate()`: 退出 plan mode
   - `getReminders(round)`: round 等于激活轮次时返回完整 plan mode 提示；后续轮次返回 `"Plan Mode 已激活，plan file: <path>"` 的简短标签；非 plan mode 状态返回空数组
   - `toProvider(): ReminderProvider`: 返回 `(round) => this.getReminders(round)`，将类实例适配为函数类型，供 AgentLoop 和 ChatService 统一使用

**验证：** 手动调用各 provider，检查返回的 SystemReminder 格式和内容

## T5: 创建 `src/prompt/index.ts` — 导出聚合

**文件：** `src/prompt/index.ts`
**依赖：** T2, T3, T4
**步骤：**
1. 从 `types.ts` 导出全部
2. 从 `builder.ts` 导出 `SystemPromptBuilder`
3. 从 `sections.ts` 导出七个函数
4. 从 `reminders.ts` 导出 `wrapReminder`、`reminderToMessage`、`createEnvInfoProvider`、`PlanModeReminderProvider`

**验证：** `pnpm exec tsc --noEmit` 编译通过

## T6: 修改六个工具的 description — 规则强化

**文件：** `src/tool/tools/read-file.ts`、`edit-file.ts`、`write-file.ts`、`glob.ts`、`grep.ts`、`run-command.ts`
**依赖：** 无
**步骤：**
1. `read_file` 的 description 末尾追加：`编辑文件前必须先用本工具读取文件内容。`
2. `edit_file` 的 description 末尾追加：`调用前必须先用 read_file 读取文件确认当前内容。old_string 必须与文件原文完全一致。`
3. `write_file` 的 description 末尾追加：`覆盖已有文件前必须先用 read_file 确认当前内容。`
4. `glob` 的 description 末尾追加：`查找文件时优先用本工具而非 ls 或 find 命令。`
5. `grep` 的 description 末尾追加：`搜索代码符号时优先用 codegraph_search 工具。`
6. `run_command` 的 description 末尾追加：`优先使用专用工具（read_file、edit_file、glob、grep）而非 cat、sed、echo 等 shell 命令。`

**验证：** 检查六个工具的 description 末尾均有新增的提醒文本

## T7: 修改 `src/provider/types.ts` — LLMProvider 接口

**文件：** `src/provider/types.ts`
**依赖：** 无
**步骤：**
1. `LLMProvider.streamChat` 方法新增可选参数 `systemPrompt?: string`
2. 保留旧参数不变，systemPrompt 默认值为 `""`

**验证：** `pnpm exec tsc --noEmit`，确认现有调用处不报错（可选参数兼容）

## T8: 修改 `src/provider/anthropic.ts` — 适配 systemPrompt

**文件：** `src/provider/anthropic.ts`
**依赖：** T7
**步骤：**
1. `streamChat` 方法签名新增 `systemPrompt` 参数
2. `buildRequestBody` 新增 `systemPrompt` 参数
3. 用 `systemPrompt` 替代原来从 messages 中分离 system 消息的逻辑：
   - 如果 `systemPrompt` 非空，放入 `body.system` 数组（单个元素）
   - messages 中不再过滤 system role 消息（由调用方保证 messages 不含 system role）
4. 不再从 messages 数组中读取 system role 消息

**验证：** 单元测试：传入 systemPrompt + messages（不含 system role），验证 body.system 字段正确

## T9: 修改 `src/provider/openai.ts` — 适配 systemPrompt

**文件：** `src/provider/openai.ts`
**依赖：** T7
**步骤：**
1. `streamChat` 方法签名新增 `systemPrompt` 参数
2. `buildRequestBody` 新增 `systemPrompt` 参数
3. 如果 `systemPrompt` 非空，在 messages 数组头部插入 `{ role: "system", content: systemPrompt }`
4. 类似 T8，不再依赖 messages 中已有的 system role

**验证：** 单元测试：传入 systemPrompt + messages（不含 system role），验证 body.messages[0] 为 system 消息

## T10: 修改 `src/agent/loop.ts` — reminders 回调

**文件：** `src/agent/loop.ts`
**依赖：** T1, T4
**步骤：**
1. `run()` 方法新增参数 `systemPrompt: string` 和 `getReminders?: ReminderProvider`
2. 在每轮 `while(round < maxRounds)` 开始处：
   a. 调用 `getReminders?.(round)`，获取本轮 reminders
   b. 对每个 reminder 调用 `reminderToMessage(reminder)`（从 `../prompt/reminders.js` 导入），生成 `<system-reminder>` 包装的 Message，插入到 messages 末尾
   c. `<system-reminder>` 消息排在最新 user 消息之前（即倒数第二条）
3. 将 `systemPrompt` 传给 `provider.streamChat()`
4. `AgentLoopConfig` 里可移除随此改动变得多余的字段

**验证：** 现有循环测试通过，新增场景：传入 mock getReminders，验证消息注入位置正确

## T11: 修改 `src/chat/chat-service.ts` — 集成装配

**文件：** `src/chat/chat-service.ts`
**依赖：** T2, T3, T4, T8, T9, T10
**步骤：**
1. 构造函数中初始化 `SystemPromptBuilder`，add 七个固定 section，调用 `build()` 得到 `systemPrompt`
2. 初始化 `EnvInfoProvider` 和 `PlanModeReminderProvider`
3. 组合多个 ReminderProvider：每轮调用所有 provider，合并结果
4. `sendMessage()` 中：
   a. `/plan` 命令：调用 `planModeReminder.activate(round)`，写入 plan mode 状态
   b. `/do` 命令：调用 `planModeReminder.deactivate()`
5. 将 `systemPrompt` 和组合后的 `getReminders` 传给 `agentLoop.run()`
6. 移除原有的：
   - 硬编码系统提示字符串
   - `ensurePlanModePrompt()` 方法
   - `removePlanModePrompt()` 方法
   - `PLAN_MODE_PROMPT` 的 import

**验证：** `pnpm test` 全部通过

## T12: 新建 `src/__tests__/prompt/builder.test.ts`

**文件：** `src/__tests__/prompt/builder.test.ts`
**依赖：** T2
**步骤：**
1. 测试：add 3 个 section，build() 按 priority 排序
2. 测试：set() 替换已有 section
3. 测试：空 builder 的 build() 返回空字符串
4. 测试：debug() 输出含模块名和 priority

**验证：** `pnpm test __tests__/prompt/builder.test.ts` 通过

## T13: 新建 `src/__tests__/prompt/sections.test.ts`

**文件：** `src/__tests__/prompt/sections.test.ts`
**依赖：** T3
**步骤：**
1. 遍历七个函数，验证每个返回的 Section 对象 name、priority、content 均非空
2. 验证七个 priority 唯一（无重复）
3. 验证关键规则关键词在对应 section 中出现

**验证：** `pnpm test __tests__/prompt/sections.test.ts` 通过

## T14: 新建 `src/__tests__/prompt/reminders.test.ts`

**文件：** `src/__tests__/prompt/reminders.test.ts`
**依赖：** T4
**步骤：**
1. 测试 `wrapReminder` 输出的格式
2. 测试 `reminderToMessage` 生成的 Message role 为 user，content 含 `<system-reminder>` 标签
3. 测试 `PlanModeReminderProvider`：
   - 未激活时返回空
   - 激活轮次返回完整 prompt
   - 后续轮次返回简短标签
   - deactivate 后返回空

**验证：** `pnpm test __tests__/prompt/reminders.test.ts` 通过

## 执行顺序

```
T1 ──┬── T2 ──────┬── T5 ──────────────┐
     ├── T3 ──────┘                     │
     ├── T4 ──────┬── T10 ──────────────┤
     │            │                     │
T6 (独立)         │                     │
T7 ──┬── T8 ─────┼─────────────────────┤
     └── T9 ─────┼─────────────────────┤
                  └── T11 (集成装配) ───┘
                                        │
T12 (依赖 T2)、T13 (依赖 T3)、T14 (依赖 T4) — 可与 T5-T11 并行
```
