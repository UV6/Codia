# 提示词管线 Plan

## 架构概览

整体分为三层：

```
┌──────────────────────────────────────────────────────┐
│  ChatService (装配层)                                  │
│  - 持有 SystemPromptBuilder (构建一次，全会话复用)       │
│  - 收集环境上下文，生成 <system-reminder> 消息            │
│  - 管理 Plan Mode 注入节奏 (首轮完整 / 后续标签)         │
│  - 将 system prompt + reminders + messages 传给 AgentLoop │
├──────────────────────────────────────────────────────┤
│  AgentLoop (循环层)                                    │
│  - 每轮调用前，通过 getReminders 回调获取注入消息         │
│  - 将 reminder 消息插入对话历史末尾                       │
│  - 其余逻辑不变                                          │
├──────────────────────────────────────────────────────┤
│  Provider (传输层)                                      │
│  - Anthropic: system → API system[] 参数                │
│  - Anthropic: conversation → API messages[] 数组         │
│  - OpenAI: system → API messages[] 中 role:system 消息   │
│  - 工具列表 → API tools 参数 (不变)                       │
└──────────────────────────────────────────────────────┘
```

新增 `src/prompt/` 模块负责构造 system prompt 和 system-reminder，不关心网络传输。Provider 层只做格式映射。

## 核心数据结构

### Section

```typescript
interface Section {
  name: string;       // 模块名（"身份"、"工具使用" 等）
  priority: number;   // 优先级，小的排前面
  content: string;    // 模块文本内容
}
```

### SystemPromptBuilder

```typescript
class SystemPromptBuilder {
  // 添加一个模块（自动按 priority 排序）
  add(section: Section): void;
  // 替换某个名称的模块
  set(section: Section): void;
  // 构建最终 system prompt 文本，模块间空行分隔
  build(): string;
  // 调试输出各模块名称和顺序
  debug(): string;
}
```

### SystemReminder

```typescript
interface SystemReminder {
  source: string;           // 来源标识（"plan-mode"、"env-info"、"mcp"）
  content: string;          // 纯文本（不含 <system-reminder> 标签本身）
  round: number;            // 注入时的轮次
}
```

### ReminderProvider（函数类型）

```typescript
type ReminderProvider = (round: number) => SystemReminder[];
```

每轮 AgentLoop 开始前，ChatService 调用 `ReminderProvider` 获取本轮应注入的 reminder 列表，包装为 `<system-reminder>` 消息后插入对话历史。

## 模块设计

### 模块 A: `src/prompt/builder.ts` — SystemPrompt 构造器

**职责：** 收集 Section，按优先级排序，拼装成最终的 system prompt 文本。

**对外接口：**
- `SystemPromptBuilder` 类，提供 `add(section)`、`set(section)`、`build()`、`debug()` 方法

**依赖：** 无外部依赖

### 模块 B: `src/prompt/sections.ts` — 七个固定模块内容

**职责：** 定义七个固定模块的文本内容。每个模块是一个函数，返回 Section 对象。

**对外接口：**
- `identitySection()` → 身份
- `constraintsSection()` → 系统约束
- `taskModeSection()` → 任务模式
- `actionSection()` → 动作执行
- `toolUseSection()` → 工具使用
- `toneSection()` → 语气风格
- `outputSection()` → 文本输出

**依赖：** 仅依赖 Section 类型

### 模块 C: `src/prompt/reminders.ts` — SystemReminder 注入

**职责：** 管理动态信息的封装和注入逻辑。

**对外接口：**
- `wrapReminder(reminder: SystemReminder): string` — 将 SystemReminder 包装为 `<system-reminder>...</system-reminder>` 文本
- `reminderToMessage(reminder: SystemReminder): Message` — 生成 role=user 的注入消息
- `EnvInfoProvider` — 收集系统运行环境和 Git 上下文的 ReminderProvider 实现
- `PlanModeReminderProvider` — 有状态类，管理 Plan Mode 注入节奏。通过 `.toProvider(): ReminderProvider` 方法适配为函数类型，供 AgentLoop 统一调用

**依赖：** Message 类型、SystemReminder 类型

### 模块 D: `src/prompt/index.ts` — 导出聚合

**职责：** 统一导出 `src/prompt/` 下的所有公开 API。

## 模块交互

```
用户发送消息
    │
    ▼
ChatService.sendMessage()
    │
    ├─ 1. 首次调用时：构造 SystemPromptBuilder
    │     添加七个固定 Section → build() 得到 systemPrompt
    │     后续轮次复用同一 systemPrompt，不重建
    │
    ├─ 2. /plan 命令：更新 PlanModeReminderProvider 状态
    │     首轮注入完整 Plan Mode 提示
    │
    ├─ 3. 每轮 AgentLoop.run() 前：
    │     a. 调用 EnvInfoProvider(round) → 获取环境信息 reminder
    │     b. 调用 PlanModeReminderProvider(round) → 获取 plan mode reminder
    │     c. 所有 reminder 包装为 <system-reminder> 的 Message
    │     d. 插入到对话历史末尾（本轮 user 消息之前）
    │
    ├─ 4. Provider.streamChat() 被调用：
    │     Anthropic:
    │       system → systemPrompt (稳定，缓存友好)
    │       messages → [历史消息..., reminder 消息, 最新 user 消息]
    │     OpenAI:
    │       messages → [{role:system, content:systemPrompt}, 历史消息..., reminder, 最新 user]
    │
    ▼
LLM 响应
```

## 文件组织

```
src/prompt/
├── types.ts        — Section、SystemReminder、ReminderProvider 类型定义
├── builder.ts      — SystemPromptBuilder 类
├── sections.ts     — 七个固定 Section 函数
├── reminders.ts    — SystemReminder 包装、EnvInfoProvider、PlanModeReminderProvider
└── index.ts        — 导出聚合

src/provider/
├── anthropic.ts    — 修改：接受独立的 systemPrompt 参数，不再从 messages 中分离 system
└── openai.ts       — 修改：接受独立的 systemPrompt 参数，拼为 role:system 消息

src/chat/
└── chat-service.ts — 修改：使用 SystemPromptBuilder + ReminderProvider，替代硬编码

src/agent/
└── loop.ts         — 修改：每轮调用前通过回调获取并注入 reminder 消息
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| System Prompt 缓存策略 | Anthropic: system 参数数组（前缀匹配缓存） | system 内容稳定不变时，前缀缓存命中率最高。变化信息移到 messages 中，不破坏前缀 |
| `<system-reminder>` 的 role | `user` | 不新增 role 类型保持兼容性。XML 标签让模型自己区分系统指令和用户输入 |
| Plan Mode 注入节奏 | 首轮完整注入 + 后续 `<system-reminder>Plan Mode active</system-reminder>` 标签 | 首轮需要完整行为约束，后续模型已在上下文中，简短标签足够提醒 |
| Provider 接口改造 | 新增 `systemPrompt: string` 参数，不从 messages 中分离 system | 语义清晰：system prompt 和 conversation 是两个独立概念。Anthropic 分别映射，OpenAI 合并为一条 system 消息 |
| Section 排序 | 用 `priority` 数字字段，小值排前面 | 简单直观，新增模块只需选一个 priority 值插入 |
| 工具描述中的规则强化 | 在六个工具的 `description` 字段末尾各加一行提醒 | 不改变工具接口，模型在每次 tool_use 决策时都能看到规则 |
| LLMProvider 接口兼容 | 添加可选参数而非修改签名 | `systemPrompt?: string`，默认空。不传时行为不变——向后兼容 |
