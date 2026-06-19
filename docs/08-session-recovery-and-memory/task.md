# 会话恢复与分层记忆管理 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/bootstrap/context-builder.ts` | 启动恢复编排，组装 `BootstrapContext` |
| 新建 | `src/bootstrap/types.ts` | 定义启动恢复上下文与诊断结构 |
| 新建 | `src/instruction/loader.ts` | 三层 `MEWCODE.md` 加载与优先级拼接 |
| 新建 | `src/instruction/resolver.ts` | `@include` 展开、深度限制、visited、防越界 |
| 新建 | `src/instruction/types.ts` | 项目指令模块数据结构 |
| 新建 | `src/memory/store.ts` | 项目级 / 用户级记忆文件与索引读写 |
| 新建 | `src/memory/index.ts` | 记忆索引裁剪、渲染、重建 |
| 新建 | `src/memory/extractor.ts` | 自然结束后异步提炼记忆并决定新增/更新/跳过 |
| 新建 | `src/memory/types.ts` | 自动记忆模块数据结构 |
| 新建 | `src/chat/recovery.ts` | 会话恢复清洗：坏行、尾部截断、时间提醒、恢复前压缩 |
| 修改 | `src/chat/history.ts` | 会话路径、ID 生成、摘要扫描、恢复入口、过期清理 |
| 修改 | `src/chat/chat-service.ts` | 接入 `BootstrapContext`，在自然结束后调度记忆提炼 |
| 修改 | `src/prompt/sections.ts` | 新增项目指令 section 与记忆索引 section |
| 修改 | `src/config/index.ts` | 增加恢复/记忆相关配置与默认值 |
| 修改 | `bin/codia.tsx` | 接入新会话/恢复会话启动上下文编排（如果入口层需要显式区分） |
| 新建 | `src/__tests__/instruction/loader.test.ts` | 覆盖三层加载与优先级 |
| 新建 | `src/__tests__/instruction/resolver.test.ts` | 覆盖 include 展开、安全限制、环路检测 |
| 新建 | `src/__tests__/chat/history-recovery.test.ts` | 覆盖坏行跳过、尾部截断、恢复前压缩入口 |
| 新建 | `src/__tests__/chat/session-cleanup.test.ts` | 覆盖 30 天过期清理 |
| 新建 | `src/__tests__/memory/store.test.ts` | 覆盖 note/index 读写 |
| 新建 | `src/__tests__/memory/index.test.ts` | 覆盖 200 行 / 25KB 索引裁剪 |
| 新建 | `src/__tests__/memory/extractor.test.ts` | 覆盖提炼任务输入输出与去重决策边界 |
| 新建 | `src/__tests__/bootstrap/context-builder.test.ts` | 覆盖新会话/恢复会话上下文组装 |
| 新建 | `src/__tests__/prompt/bootstrap-sections.test.ts` | 覆盖新增 section 注入结果 |
| 新建 | `docs/08-session-recovery-and-memory/task.md` | 本阶段任务拆解文档 |
| 新建 | `docs/08-session-recovery-and-memory/checklist.md` | 本阶段验收设计文档，需与 spec/plan/task 同步维护 |

## T1: 定义启动恢复与项目指令数据结构

**文件：**
- `src/bootstrap/types.ts`
- `src/instruction/types.ts`
- `src/memory/types.ts`

**依赖：** 无

**步骤：**
1. 在 `src/bootstrap/types.ts` 中定义 `BootstrapContext`、diagnostics 相关结构
2. 在 `src/instruction/types.ts` 中定义 `InstructionLayer`、`ResolvedInstructionDocument`、`InstructionResolveOptions`
3. 在 `src/memory/types.ts` 中定义 `MemoryNote`、`MemoryIndexEntry`、`MemoryExtractionJob`
4. 保持字段命名与 `plan.md` 一致，避免后续任务再改类型名

**验证：**
- 运行 `pnpm test`，确认新增类型文件被项目正常编译

## T2: 实现项目指令引用解析器

**文件：**
- `src/instruction/resolver.ts`

**依赖：** T1

**步骤：**
1. 实现单个 `MEWCODE.md` 文件读取
2. 实现 `@include` 语法扫描与递归展开
3. 加入 `maxIncludeDepth` 限制
4. 使用 `visited` 集合防止循环引用
5. 对项目级文件的 include 做路径越界拦截，并限制用户级入口后续 include 只能访问 `~/.mewcode/` 子树
6. 保留 warning 输出，而不是直接抛 fatal error

**验证：**
- 新增并运行 `src/__tests__/instruction/resolver.test.ts`
- 覆盖正常 include、循环 include、超深、越界四类场景

## T3: 实现三层项目指令加载与优先级拼装

**文件：**
- `src/instruction/loader.ts`
- `src/__tests__/instruction/loader.test.ts`

**依赖：** T1, T2

**步骤：**
1. 固定三层入口路径：
   - `<project-root>/MEWCODE.md`
   - `<project-root>/.mewcode/MEWCODE.md`
   - `~/.mewcode/MEWCODE.md`
2. 定义三层优先级顺序
3. 调用解析器展开每层内容
4. 生成最终拼接文本与诊断信息
5. 缺失入口文件时跳过并记录可追踪信息

**验证：**
- 运行 `src/__tests__/instruction/loader.test.ts`
- 断言三层顺序、缺失层跳过、warning 透传都符合预期

## T4: 扩展会话路径与会话 ID 生成规则

**文件：**
- `src/chat/history.ts`

**依赖：** 无（可并行于 T2/T3，但建议顺序执行）

**步骤：**
1. 把会话目录切换为项目内 `sessions/`
2. 将新会话 ID 改为 `YYYYMMDD-HHMMSS-xxxx`
3. 保持每会话一个 JSONL 文件
4. 保持追加写模式不变
5. 确保已有按文件名解析 ID 的逻辑同步更新，并保持 `--sessions` 列表与恢复入口可用

**验证：**
- 为 `newSessionPath()` / `sessionPath()` 补测试或扩展现有 history 测试
- 断言路径位置、文件名格式和同秒不撞名

## T5: 实现会话恢复清洗逻辑

**文件：**
- `src/chat/recovery.ts`
- `src/__tests__/chat/history-recovery.test.ts`

**依赖：** T4

**步骤：**
1. 从原始记录中重建可恢复消息序列
2. 跳过坏行或非法记录
3. 兼容当前旧格式单工具结果记录与新格式同轮多工具结果记录
4. 检查尾部未闭合的工具调用相关记录
5. 将历史截断到最后一个安全位置
6. 产出 `SessionRecoveryResult` 需要的 flags 和 warnings

**验证：**
- 运行 `src/__tests__/chat/history-recovery.test.ts`
- 覆盖坏行跳过、尾部半写入、旧格式单工具结果、新格式同轮多工具结果、末尾工具未闭合五类场景

## T6: 在恢复流程中接入时间跨度提醒与恢复前压缩

**文件：**
- `src/chat/recovery.ts`
- `src/context/manager.ts`（如仅调用则可能不改）
- `src/__tests__/chat/history-recovery.test.ts`

**依赖：** T5

**步骤：**
1. 判断恢复会话距离上次活动是否超过阈值
2. 超阈值时插入一条时间跨度提醒消息
3. 判断恢复消息是否超出安全上下文范围
4. 超限时只写入一次性压缩标记，把真正压缩交给首轮正常请求链路执行
5. 在恢复结果中标记 `gapNoticeInserted` 与 `compressed` 或等价的一次性压缩状态

**验证：**
- 扩展 `src/__tests__/chat/history-recovery.test.ts`
- 覆盖“插入提醒”“写入一次性压缩标记”和“不会重复压缩”的分支

## T7: 扩展 history 模块的扫描、恢复与清理入口

**文件：**
- `src/chat/history.ts`
- `src/__tests__/chat/session-cleanup.test.ts`

**依赖：** T4, T5, T6

**步骤：**
1. 在 `history.ts` 中接入 `recoverSession(...)`
2. 让会话摘要扫描返回 corruption / recoverable / warnings 信息
3. 实现超过 30 天的过期会话清理
4. 保持“会话摘要仍由 JSONL 自身推导”这一约束

**验证：**
- 运行 `src/__tests__/chat/session-cleanup.test.ts`
- 断言过期删除只影响过期文件
- 断言摘要字段来自 JSONL 扫描而非外部 meta

## T8: 实现记忆索引读写与裁剪

**文件：**
- `src/memory/index.ts`
- `src/memory/store.ts`
- `src/__tests__/memory/index.test.ts`
- `src/__tests__/memory/store.test.ts`

**依赖：** T1

**步骤：**
1. 定义用户级 / 项目级 memory 路径规则（用户级：`~/.mewcode/memory/`；项目级：`<project-root>/memory/`）
2. 实现索引读取与写入
3. 实现索引渲染为注入文本
4. 加入 200 行 / 25KB 裁剪逻辑
5. 实现 note 文件与索引文件的基础 upsert

**验证：**
- 运行 `src/__tests__/memory/index.test.ts`
- 运行 `src/__tests__/memory/store.test.ts`
- 覆盖双 scope、索引裁剪、note upsert 三类场景

## T9: 实现自动记忆提炼任务接口

**文件：**
- `src/memory/extractor.ts`
- `src/__tests__/memory/extractor.test.ts`

**依赖：** T1, T8

**步骤：**
1. 定义提炼任务输入输出
2. 接收本轮消息范围与已有索引摘要
3. 抽象出“新增 / 更新 / 跳过”的决策结果结构
4. 接好 LLM 去重决策边界与数据流
5. 将提炼结果落到 note upsert 和 index rebuild 的最小可用闭环
6. 保证失败时只返回 warning，不中断主对话

**验证：**
- 运行 `src/__tests__/memory/extractor.test.ts`
- 覆盖空结果、更新已有项、跳过重复项，以及提炼后能落盘并更新索引四类边界

## T10: 实现启动恢复编排器

**文件：**
- `src/bootstrap/context-builder.ts`
- `src/__tests__/bootstrap/context-builder.test.ts`

**依赖：** T3, T7, T8

**步骤：**
1. 实现 `buildNewSessionContext(projectRoot, now)`
2. 实现 `buildResumeContext(projectRoot, sessionId, now)`
3. 组装 `instructionText`、`memoryText`、`recoveredMessages`、`diagnostics`
4. 保证单个子模块失败时仍尽量返回可用上下文

**验证：**
- 运行 `src/__tests__/bootstrap/context-builder.test.ts`
- 覆盖新会话、恢复旧会话、局部失败降级三类场景

## T11: 扩展 prompt section 注入项目指令与记忆索引

**文件：**
- `src/prompt/sections.ts`
- `src/__tests__/prompt/bootstrap-sections.test.ts`

**依赖：** T3, T8

**步骤：**
1. 新增项目指令 section
2. 新增记忆索引 section
3. 保持现有固定 section 机制不被破坏
4. 确保恢复文本不混入环境信息 section

**验证：**
- 运行 `src/__tests__/prompt/bootstrap-sections.test.ts`
- 断言 section 顺序、命名与输出文本符合预期

## T12: 接入 ChatService 启动恢复与异步记忆调度

**文件：**
- `src/chat/chat-service.ts`
- `src/config/index.ts`
- `bin/codia.tsx`（如需要）
- 相关集成测试文件

**依赖：** T6, T9, T10, T11

**步骤：**
1. 新增显式的异步 bootstrap 入口（例如 `ChatService.create(...)` 或等价工厂）
2. 让 CLI 入口在 render 前等待 bootstrap 完成
3. 用 `BootstrapContext` 初始化恢复消息与首轮 prompt，并把项目指令 / 记忆 section 纳入完整组装顺序
4. 扩展配置项：include 深度、时间阈值、保留天数、索引限制、自动记忆开关
5. 在一轮自然结束后调度 `MemoryExtractionJob`
6. 确保主流程失败时仍能降级启动

**验证：**
- 运行与 chat/config 相关的测试
- 最终执行 `pnpm test`，要求全部通过

## 执行顺序

```text
T1
├─→ T2 ─→ T3
├─→ T8 ─→ T9
└─→ T4 ─→ T5 ─→ T6 ─→ T7

T3 + T7 + T8 ─→ T10
T3 + T8 ─→ T11
T6 + T9 + T10 + T11 ─→ T12
```
