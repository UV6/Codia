# 会话恢复与分层记忆管理 Plan

## 架构概览

本次实现采用 **启动恢复管线 + 三个领域模块 + 一个编排入口** 的结构。

### 启动恢复编排器
负责在新会话启动前按固定顺序执行恢复流程，统一收集恢复结果，并产出最终要注入的启动上下文。它本身不保存业务数据，只负责串联项目指令加载、会话恢复、记忆索引注入三个模块。

### 项目指令模块
负责加载多层项目指令文件、处理引用展开、执行优先级排序，并生成最终的项目指令文本。这个模块只关心“哪些指令应该被读入、以什么顺序展开、哪些引用该被拒绝”，不负责会话历史和记忆笔记。

### 会话存档与恢复模块
负责生成新会话 ID 与文件路径、追加写 JSONL、扫描会话列表摘要、从历史会话中恢复可安全使用的消息序列，并在恢复前处理坏行、未配对工具记录、上下文超限和时间跨度提醒。这个模块继续以 JSONL 为唯一事实来源，不引入独立 meta 文件。

### 自动记忆模块
负责在 Agent Loop 自然结束后，异步提炼本轮可复用知识，决定新增、更新或跳过笔记，并维护项目级/用户级的记忆索引文件。它的职责是“沉淀与注入长期记忆”，不参与短期会话消息的持久化。

### Prompt 注入适配层
负责把项目指令文本、恢复后的会话消息、用户级/项目级记忆索引接入现有 prompt / message 构造流程，保证这些恢复结果会在首轮模型请求前进入上下文。它不自己做存储，只负责把恢复结果装配到现有调用链中。

### 清理与维护子流程
负责周期性删除过期会话、控制索引体积，并为恢复链路产出可追踪的诊断信息。它作为后台维护能力存在，不阻塞主对话启动；若失败，应降级为记录问题并继续启动。

## 核心数据结构

### `InstructionLayer`
**字段：**
- `name`：层名称，用于日志与调试展示
- `priority`：层优先级，数值越小越靠前
- `scope`：作用域，区分项目根目录、项目私有目录、用户目录
- `path`：该层入口文件路径
- `required`：是否必须存在；不存在时是跳过还是报出可追踪提示

**用途：**
- 定义三层项目指令的加载顺序
- 让指令系统不依赖硬编码散落在各处的路径判断

### `ResolvedInstructionDocument`
**字段：**
- `sourcePath`：原始文件路径
- `displayPath`：用于日志展示的相对路径
- `content`：展开后的正文
- `depth`：当前展开深度
- `includedFrom`：上游引用来源；顶层文件为空
- `warnings`：该文件展开过程中产生的警告，如超深、越界、循环引用被拦截

**用途：**
- 保存单个文档的展开结果
- 为最终拼装后的指令文本提供可追踪来源

### `InstructionResolveOptions`
**字段：**
- `maxIncludeDepth`：最大嵌套层数
- `projectRoot`：当前项目根目录
- `allowExternalUserFile`：是否允许读取用户目录中的用户级入口文件
- `visited`：已访问文件集合，用于防环路
- `includeToken`：引用语法标记

**用途：**
- 统一约束 `@include` 展开行为
- 避免把路径安全、层数控制、环路控制分散到调用方

### `SessionRecord`
**字段：**
- `role`：消息角色
- `content`：文本内容
- `toolCalls`：工具调用信息
- `toolResult`：单个工具返回结果（兼容旧格式）
- `toolUseId`：单个工具结果与调用的关联标识（兼容旧格式）
- `toolResults`：同轮多个工具结果（兼容当前新格式）
- `timestamp`：时间戳
- `meta`：可选扩展字段，例如恢复标记、压缩标记、提醒标记

**用途：**
- 作为会话文件中的单行对象结构
- 兼容当前消息模型，同时为恢复期插入系统提示保留扩展位

### `SessionSummary`
**字段：**
- `id`：会话 ID
- `path`：文件路径
- `title`：会话标题或首条用户消息预览
- `messageCount`：有效消息数
- `lastActivityAt`：最后活动时间
- `isCorrupted`：是否存在坏行
- `recoverable`：是否可以恢复
- `warnings`：扫描阶段发现的问题摘要

**用途：**
- 支撑会话列表展示
- 替代独立 meta 文件

### `SessionRecoveryResult`
**字段：**
- `sessionId`：被恢复的会话 ID
- `messages`：恢复后可安全使用的消息序列
- `truncated`：是否发生尾部截断
- `compressed`：是否执行过恢复前压缩
- `gapNoticeInserted`：是否插入时间跨度提醒
- `warnings`：坏行跳过、未配对截断等恢复提示
- `lastActivityAt`：恢复前会话的最后活动时间

**用途：**
- 给启动恢复编排器一个结构化恢复结果
- 明确告诉上层“恢复成功了多少、做过哪些修补动作”

### `MemoryNote`
**字段：**
- `id`：笔记标识
- `scope`：`user` 或 `project`
- `category`：用户偏好、纠正反馈、项目知识、参考资料
- `title`：笔记标题
- `summary`：索引中使用的简述
- `body`：完整正文
- `sourceSessionId`：来源会话
- `updatedAt`：最后更新时间
- `tags`：可选标签或辅助分类标记

**用途：**
- 统一自动笔记的文件内容与元信息
- 支撑“新增 / 更新 / 跳过”的记忆决策

### `MemoryIndexEntry`
**字段：**
- `noteId`：对应笔记 ID
- `category`：记忆类别
- `summary`：简短摘要
- `updatedAt`：更新时间
- `path`：原笔记路径

**用途：**
- 给启动阶段快速注入用
- 避免首轮请求前扫描全部笔记正文

### `BootstrapContext`
**字段：**
- `instructionText`：项目指令拼装结果
- `memoryText`：用户级 + 项目级记忆索引拼装结果
- `recoveredMessages`：恢复后的历史消息
- `diagnostics`：本次恢复过程的诊断信息
- `sessionSummary`：当前恢复会话的摘要信息（如有）

**用途：**
- 作为恢复编排器与现有会话入口之间的边界对象
- 避免 `ChatService` 分别理解三个子系统的内部细节

### `MemoryExtractionJob`
**字段：**
- `sessionId`：来源会话
- `turnRange`：本轮消息范围
- `projectRoot`：项目根目录
- `existingMemoryIndex`：当前可见索引摘要
- `triggeredAt`：任务触发时间

**用途：**
- 支撑异步记忆更新
- 让“对话主流程结束”和“记忆沉淀”解耦

## 核心接口

### `InstructionLoader`
**职责：** 加载并展开多层项目指令，输出排序后的最终文本与诊断信息。

**方法：**
- `loadForProject(projectRoot): InstructionLoadResult`
- `resolveEntry(layer, options): ResolvedInstructionDocument[]`

### `SessionStore`
**职责：** 管理会话文件的创建、追加写、扫描摘要与恢复。

**方法：**
- `createSessionPath(now): string`
- `append(record): void`
- `listSessions(): SessionSummary[]`
- `recover(sessionId): SessionRecoveryResult`
- `cleanupExpired(now): CleanupResult`

### `MemoryStore`
**职责：** 管理自动笔记与记忆索引。

**方法：**
- `loadIndexes(projectRoot): MemoryIndexBundle`
- `scheduleExtraction(job): void`
- `upsertNote(note): NoteWriteResult`
- `rebuildIndex(scope): IndexBuildResult`
- `resolvePaths(projectRoot): MemoryPathBundle`

### `BootstrapContextBuilder`
**职责：** 协调三个领域模块，产出启动上下文。

**方法：**
- `buildNewSessionContext(projectRoot): BootstrapContext`
- `buildResumeContext(projectRoot, sessionId): BootstrapContext`

## 模块设计

### `src/bootstrap/`
这一层是新增的启动恢复编排层，负责把“新会话启动前需要恢复什么”从 `ChatService` 中抽出来。

#### `bootstrap/context-builder.ts`
**职责：**
- 协调项目指令、会话恢复、记忆索引三个模块
- 根据“新会话”或“恢复旧会话”两种场景生成 `BootstrapContext`
- 汇总恢复过程中的 warning / diagnostics

**对外接口：**
- `buildNewSessionContext(projectRoot, now)`
- `buildResumeContext(projectRoot, sessionId, now)`

**依赖：**
- `InstructionLoader`
- `SessionStore`
- `MemoryStore`

### `src/instruction/`
这一层是新增的项目指令模块，负责三层指令与 `@include` 解析。

#### `instruction/loader.ts`
**职责：**
- 定义三层入口文件位置
- 按优先级顺序加载各层
- 产出拼接后的最终指令文本

**对外接口：**
- `loadForProject(projectRoot)`

**依赖：**
- `instruction/resolver.ts`

#### `instruction/resolver.ts`
**职责：**
- 解析单个入口文件
- 展开 `@include`
- 处理 visited、防环路、深度限制、路径越界拦截

**对外接口：**
- `resolveEntry(layer, options)`
- `resolveInclude(currentFile, includePath, options)`

**依赖：**
- 无业务依赖，只依赖文件系统与路径工具

#### `instruction/types.ts`
**职责：**
- 定义 `InstructionLayer`、`ResolvedInstructionDocument`、`InstructionResolveOptions` 等结构

**依赖：**
- 无

### `src/chat/history.ts`
这是现有模块的扩展点，继续保留“JSONL 是唯一事实来源”的设计。

#### 扩展后的 `history.ts`
**职责：**
- 生成新会话路径
- 追加写消息
- 扫描会话摘要
- 恢复历史会话
- 清理过期会话

**对外接口：**
- `newSessionPath(now?)`
- `appendMessage(filePath, record)`
- `listSessions()`
- `recoverSession(filePath, options)`
- `cleanupExpiredSessions(now, retentionDays)`

**依赖：**
- `contextManager`（仅在恢复前压缩路径上使用）
- `chat/recovery.ts`（如果把恢复逻辑拆出去）

### `src/chat/recovery.ts`
这是建议新增的会话恢复逻辑模块。

**职责：**
- 从原始 JSONL 记录重建可恢复消息序列
- 跳过坏行
- 检测末尾未配对工具调用/工具结果
- 截断到最后一个安全位置
- 在需要时插入时间跨度提醒
- 在需要时触发一次恢复前压缩

**对外接口：**
- `recoverRecords(rawRecords, options)`
- `trimUnpairedToolRecords(records)`
- `insertGapNotice(records, lastActivityAt, now, threshold)`
- `compressIfNeeded(records, contextManager, config)`

**依赖：**
- `src/context/manager.ts`
- `src/provider/types.ts`

### `src/memory/`
这是新增的自动记忆模块，和项目指令模块分开，避免“规则”和“沉淀知识”混在一起。

#### `memory/store.ts`
**职责：**
- 管理用户级 / 项目级 memory 根目录（用户级：`~/.mewcode/memory/`；项目级：`<project-root>/memory/`）
- 读取与写入单条笔记
- 删除或更新已有笔记
- 读取索引文件

**对外接口：**
- `loadIndexes(projectRoot)`
- `listNotes(scope)`
- `upsertNote(note)`
- `deleteNote(noteId)`

**依赖：**
- `memory/index.ts`

#### `memory/index.ts`
**职责：**
- 维护索引文件
- 控制索引行数与体积
- 将索引条目拼装成注入文本

**对外接口：**
- `readIndex(scope, projectRoot)`
- `writeIndex(scope, entries)`
- `renderIndexText(bundle)`

**依赖：**
- 无业务依赖

#### `memory/extractor.ts`
**职责：**
- 在 Agent Loop 自然结束后提炼本轮可复用知识
- 调用 LLM 决定新增、更新还是跳过
- 生成标准化笔记内容

**对外接口：**
- `extractFromTurn(job)`
- `decideUpserts(existingIndex, candidateFacts)`

**依赖：**
- `provider`
- `memory/store.ts`

#### `memory/types.ts`
**职责：**
- 定义 `MemoryNote`、`MemoryIndexEntry`、`MemoryExtractionJob` 等结构

**依赖：**
- 无

### `src/prompt/`
这是现有 prompt 管线的扩展点。

#### `prompt/sections.ts` 或新增 `prompt/bootstrap.ts`
**职责：**
- 接收恢复后的项目指令文本与记忆索引文本
- 将其转成可插入 system prompt 的 section
- 保持现有固定 section 机制不变，只是新增可选 section

**对外接口：**
- `instructionSection(text)`
- `memorySection(text)`

**依赖：**
- `prompt/builder.ts`
- `prompt/types.ts`

### `src/chat/chat-service.ts`
这是现有主编排入口，但职责会收窄为“使用恢复结果”，而不是“自己恢复一切”。

**职责：**
- 在构造或初始化阶段调用 `BootstrapContextBuilder`
- 使用 `BootstrapContext` 初始化 system prompt、恢复消息和当前会话状态
- 在每轮自然结束后调度 `MemoryExtractionJob`

**对外接口：**
- 保持现有 `sendMessage()` 为主入口
- 新增内部初始化流程，不对外暴露太多新接口

**依赖：**
- `src/bootstrap/context-builder.ts`
- `src/memory/extractor.ts`
- 现有 `ContextManager`

### `src/config/`
这一层建议补充恢复相关配置，而不是把常量散落在模块内部。

#### `config/index.ts`
**职责：**
- 增加恢复/记忆相关配置读取与默认值
- 统一提供 include 最大深度、时间跨度阈值、会话保留天数、记忆索引大小限制、自动记忆是否开启

**对外接口：**
- 继续保留现有 `loadConfig()`
- 扩展返回的配置对象结构

**依赖：**
- 无新增业务依赖

## 模块交互

本次设计有两条主流程：新会话启动、恢复旧会话；另有一条后台流程：自然停顿后的自动记忆更新。

### 一、新会话启动流程
**目标：** 在用户发出首条消息前，先把项目指令和记忆索引准备好；新会话本身没有历史消息可恢复。

**调用链：**
1. CLI 入口解析当前工作目录、配置和会话参数
2. `ChatService` 初始化时调用 `BootstrapContextBuilder.buildNewSessionContext(projectRoot, now)`
3. `BootstrapContextBuilder` 依次调用：
   - `InstructionLoader.loadForProject(projectRoot)`
   - `MemoryStore.loadIndexes(projectRoot)`
4. `InstructionLoader` 按固定顺序检查三层入口文件：
   - `<project-root>/MEWCODE.md`
   - `<project-root>/.mewcode/MEWCODE.md`
   - `~/.mewcode/MEWCODE.md`
5. `InstructionLoader` 对每层入口执行 `@include` 展开，并返回展开后的文本、被拦截的引用 warning、实际命中的文件列表
6. `MemoryStore` 读取项目级记忆索引和用户级记忆索引
7. `BootstrapContextBuilder` 组装 `BootstrapContext`
8. `ChatService` 用 `BootstrapContext` 构建首轮 system prompt：固定 prompt section、项目指令 section、记忆索引 section、环境信息 section
9. 用户首条消息进入正常 `sendMessage()` 流程
10. 新会话 JSONL 文件在首次写入时创建，并开始追加写

**结果：** 新会话没有历史消息恢复，但首轮推理前已经具备项目规则和长期记忆。

### 二、恢复旧会话流程
**目标：** 在恢复已有会话时，把历史消息修复到“可安全继续”的状态，再与项目指令、记忆索引一起注入上下文。

**调用链：**
1. CLI 入口收到“恢复某个会话”的参数
2. CLI 入口在恢复旧会话前，先通过显式的异步构建入口完成 bootstrap，并在拿到 `BootstrapContext` 后再实例化或完成初始化
3. `BootstrapContextBuilder` 依次调用：
   - `InstructionLoader.loadForProject(projectRoot)`
   - `SessionStore.recover(sessionId)`
   - `MemoryStore.loadIndexes(projectRoot)`
4. `SessionStore.recover(sessionId)` 内部分两步：`history.ts` 负责读取 JSONL 原始记录，`chat/recovery.ts` 负责恢复清洗
5. `chat/recovery.ts` 对原始记录顺序处理：
   - 跳过坏行
   - 检查工具调用 / 工具结果是否成对
   - 如果尾部不完整，截断到最后一个安全点
   - 判断是否超过时间跨度阈值，必要时插入提醒消息
   - 判断是否超出上下文安全范围，必要时调用 `ContextManager` 先压缩一次
6. `SessionStore` 返回 `SessionRecoveryResult`
7. `MemoryStore` 读取两级记忆索引
8. `BootstrapContextBuilder` 组装 `BootstrapContext`
9. `ChatService` 用恢复后的 `messages + instructionText + memoryText` 构建首轮请求
10. 后续对话继续追加写回同一个 JSONL 文件

**结果：** 坏行不阻塞恢复，不完整尾部不会污染后续对话，恢复后的首轮上下文已经过“修复 / 提醒”，并在需要时带着一次性压缩标记进入首轮请求。

### 三、自动记忆更新流程
**目标：** 在一轮 Agent Loop 自然结束后，异步提炼可复用知识，并更新笔记与索引，但不阻塞当前回复。

**触发条件：**
- 模型本轮给出最终回复
- 本轮没有继续发起工具调用
- 对话自然停在用户可见回复处

**调用链：**
1. `ChatService` 识别本轮自然结束
2. `ChatService` 构造 `MemoryExtractionJob`
3. `MemoryStore.scheduleExtraction(job)` 异步入队
4. `memory/extractor.ts` 读取本轮消息范围和当前项目级 / 用户级索引摘要
5. `memory/extractor.ts` 调用 LLM，输出候选事实及动作建议：新增、更新已有笔记、跳过
6. `memory/store.ts` 执行写入或更新
7. `memory/index.ts` 重建对应 scope 的索引文件
8. 若失败，仅记录 warning，不影响当前已完成的对话结果

**结果：** 记忆更新是“会后整理”，不把 LLM 提炼过程塞进用户当前响应延迟里。

### 四、清理流程
#### 会话清理
1. 启动时或指定维护时机触发 `SessionStore.cleanupExpired(now, retentionDays)`
2. 扫描 `sessions/` 目录
3. 删除超过保留期的 JSONL 文件
4. 返回清理数量和告警信息

#### 索引控制
1. 每次记忆写入后触发索引重建
2. `memory/index.ts` 重新裁剪条目数和总字节数
3. 超限时优先保留更近、更稳定的摘要项

### 五、关键边界
- `ChatService` 只消费 `BootstrapContext`，不自己判断三层 `MEWCODE.md` 路径，不自己扫描 `memory/` 或 `sessions/` 目录细节
- 指令模块只输出规则文本，记忆模块只输出索引文本，两者都不直接修改会话消息数组
- `SessionStore` 只负责恢复阶段的超限判断与一次性压缩标记；真正压缩仍由正常请求链路中的 `ContextManager` 执行，避免重复压缩

### 六、数据流摘要
- 新会话：`MEWCODE.md(三层) + memory indexes -> BootstrapContext -> ChatService -> 首轮请求`
- 恢复旧会话：`session.jsonl -> recover/trim/notice/mark-compress-once + MEWCODE.md(三层) + memory indexes -> BootstrapContext -> ChatService -> 首轮请求`
- 自然结束后：`本轮消息 -> MemoryExtractionJob -> LLM 提炼 -> note upsert -> index rebuild`

## 文件组织

```text
docs/
└── 08-session-recovery-and-memory/
    ├── spec.md
    ├── plan.md
    ├── task.md
    └── checklist.md

src/
├── bootstrap/
│   ├── context-builder.ts     — 启动恢复编排：组装 BootstrapContext
│   └── types.ts               — BootstrapContext、diagnostics 等结构
│
├── instruction/
│   ├── loader.ts              — 三层 MEWCODE.md 加载与优先级拼装
│   ├── resolver.ts            — @include 展开、深度限制、visited、防越界
│   └── types.ts               — InstructionLayer、ResolvedInstructionDocument 等结构
│
├── memory/
│   ├── store.ts               — 笔记文件读写、scope 路径管理、upsert/delete
│   ├── index.ts               — 记忆索引读写、裁剪、注入文本渲染
│   ├── extractor.ts           — 自然结束后异步提炼记忆、去重/更新决策
│   └── types.ts               — MemoryNote、MemoryIndexEntry、MemoryExtractionJob
│
├── chat/
│   ├── chat-service.ts        — 接入 BootstrapContext，调度恢复与记忆提炼
│   ├── history.ts             — JSONL 创建、追加写、摘要扫描、过期清理
│   └── recovery.ts            — 坏行跳过、尾部截断、时间提醒、恢复前压缩
│
├── prompt/
│   ├── builder.ts             — 现有 section builder，保持不变
│   ├── sections.ts            — 新增 instruction/memory section
│   ├── reminders.ts           — 现有提醒构造，必要时复用时间跨度提醒格式
│   └── types.ts               — 现有 prompt section 结构
│
├── config/
│   └── index.ts               — 扩展恢复/记忆相关配置读取与默认值
│
├── context/
│   └── manager.ts             — 复用现有压缩能力，供恢复前压缩调用
│
└── __tests__/
    ├── instruction/
    │   ├── loader.test.ts
    │   └── resolver.test.ts
    ├── chat/
    │   ├── history-recovery.test.ts
    │   └── session-cleanup.test.ts
    ├── memory/
    │   ├── index.test.ts
    │   ├── store.test.ts
    │   └── extractor.test.ts
    ├── bootstrap/
    │   └── context-builder.test.ts
    └── prompt/
        └── bootstrap-sections.test.ts
```

### 文件调整说明
- 新增目录：`src/bootstrap/`、`src/instruction/`、`src/memory/`
- 扩展现有目录：`src/chat/history.ts`、`src/chat/chat-service.ts`、`src/prompt/sections.ts`、`src/config/index.ts`
- 建议新增但放在现有目录下的文件：`src/chat/recovery.ts`
- 测试全部沿用现有 `src/__tests__/` 风格，不新增新的测试根目录

### 目录命名取舍
- 使用 `instruction/` 而不是 `prompt-instruction/`，因为这里处理的是项目规则文件解析，不是 prompt 字符串拼装
- 使用 `memory/` 而不是 `notes/`，因为这层不仅有单条笔记，还有索引、提炼任务、注入文本和 upsert 策略
- 不单独建 `session/`，因为现在会话历史相关代码已经在 `chat/` 下，继续保持 `chat/history.ts + chat/recovery.ts + chat/chat-service.ts` 更一致

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 项目指令入口文件名 | 三层统一使用 `MEWCODE.md` | 这是已明确指定的约束，避免每层文件名不一致带来的实现分支与理解成本。 |
| 项目指令加载层级 | `<project-root>/MEWCODE.md`、`<project-root>/.mewcode/MEWCODE.md`、`~/.mewcode/MEWCODE.md` | 对应需求中的三层来源；既支持项目显式规则，也支持项目私有补充规则和用户长期偏好。 |
| 指令优先级顺序 | 项目根 > 项目私有目录 > 用户目录，且高优先级排在更前面 | 满足“项目级高于用户级，且高优先级排前让模型优先遵循”的要求。 |
| 指令引用机制 | 使用 `@include` 做静态文本展开 | 简单、可预测、便于做深度限制和路径校验；当前阶段不需要更复杂的模板系统。 |
| 引用安全策略 | 限制最大嵌套深度 + `visited` 防环路 + 项目边界路径校验 | 正好覆盖需求里的三类异常：递归过深、循环引用、越界访问。 |
| 用户级入口的越界例外 | 仅允许显式读取 `~/.mewcode/MEWCODE.md` 作为合法外部入口，且其后续 `@include` 也只能访问 `~/.mewcode/` 子树；其余项目级引用不得跳出项目目录 | 兼顾“需要读取用户级规则”和“项目引用不能越界”这两个约束。 |
| 会话存储位置 | 使用项目内 `sessions/` 目录 | 这是需求中的明确要求；同时让会话和项目绑定，便于中断后恢复当前项目上下文。 |
| 会话文件格式 | 每个会话一个 JSONL 文件 | 追加写便宜、崩溃容错好、恢复时可跳坏行，且符合技术要求。 |
| 会话写入策略 | 逐条记录 append，不回写前文 | 简单可靠；崩溃时通常只影响最后一条，不会破坏整个会话。 |
| 会话元信息策略 | 不维护独立 meta 文件，摘要信息直接从 JSONL 扫描得出 | 少一份同步状态，避免标题/计数/最近时间和真实存档不一致。 |
| 会话 ID 格式 | `YYYYMMDD-HHMMSS-xxxx` | 这是需求中明确给出的格式，能避免同秒创建多个会话时撞名。 |
| 恢复策略 | “读取原始记录”与“恢复清洗”分层：文件读取保留在 `history.ts`，恢复修补拆到 `chat/recovery.ts` | 保持 `history.ts` 负责文件层操作，复杂恢复逻辑单独演进，避免一个文件承担两种抽象层级。 |
| 坏行处理 | 跳过坏行并记录 warning | 满足“坏行可跳过”，也避免因为单条损坏导致整个会话不可恢复。 |
| 未配对工具记录处理 | 仅对尾部未闭合工具调用/结果做安全截断 | 保守且可解释；优先保证恢复后的上下文闭合，而不是猜测缺失内容。 |
| 恢复前压缩策略 | 若恢复上下文超限，恢复阶段只标记“首轮请求前需要压缩”，实际压缩仍统一由现有 `ContextManager.preRequest()` 执行一次 | 复用现有压缩能力，并避免恢复阶段与正常请求链路重复压缩。 |
| 时间跨度提醒策略 | 若距上次活动超过阈值，插入一条系统提醒消息 | 满足需求里的“隔太久插一条时间跨度提醒”，且这种提醒最适合以消息形式进入上下文。 |
| 过期会话清理策略 | 定期删除超过 30 天的会话文件 | 与 spec 保持一致，限制目录增长，同时实现简单。 |
| 自动记忆触发时机 | 仅在 Agent Loop 自然停止、模型给出最终回复且无后续工具调用时触发 | 与要求一致，避免在中间轮次或工具链未闭合时提炼不稳定信息。 |
| 自动记忆执行方式 | 异步执行，不阻塞当前用户回复 | 记忆沉淀是“会后整理”，不该放大主路径延迟。 |
| 自动记忆分类 | 固定四类：用户偏好、纠正反馈、项目知识、参考资料 | 满足需求，且分类语义稳定，便于维护索引和后续注入。 |
| 去重策略 | 由 LLM 基于现有索引摘要判断“新增 / 更新 / 跳过” | 已明确“去重交给 LLM 判断”；索引摘要足够便宜，且比纯字符串去重更贴近语义。 |
| 记忆存储范围 | 用户级存放在 `~/.mewcode/memory/`，项目级存放在 `<project-root>/memory/`，两者分开维护索引 | 满足“用户级和项目级笔记分开存”的要求，也避免两类记忆混写。 |
| 记忆注入载体 | 注入索引文件而不是每次扫描全部原始笔记正文，且顺序固定为项目级索引在前、用户级索引在后 | 满足“处理请求前就注入上下文”且控制 token 成本，同时让项目相关知识先出现。 |
| 记忆索引约束 | 索引文件限制在 200 行 / 25KB 以内 | 这是需求中给出的上限，足以控制启动上下文体积。 |
| Prompt 集成方式 | 通过新增 prompt section 注入项目指令和记忆索引 | 比把恢复内容硬拼到环境信息里更清晰，语义边界也更稳定。 |
| 主编排位置 | 新增 `BootstrapContextBuilder`，由它协调三类恢复结果后交给 `ChatService` | 避免 `ChatService` 持续膨胀成“既做聊天又做所有恢复细节”的巨型类。 |
| 失败处理原则 | 各模块返回 diagnostics / warnings，尽量降级运行，不做单点失败中断 | 直接对应 F12，符合“局部损坏不放大”的设计目标。 |
| 本阶段边界 | 不引入向量库、RAG、团队共享、远程同步 | 与 spec 的“不做的事”保持一致，避免过度设计。 |
