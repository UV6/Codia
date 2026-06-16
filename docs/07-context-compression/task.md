# 上下文压缩 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/context/types.ts` | CompressEvent、TokenAnchor、CompressedResult 类型定义 |
| 新建 | `src/context/store.ts` | ContextStore：工具结果和摘要的磁盘读写 |
| 新建 | `src/context/token-estimator.ts` | TokenEstimator：锚点 + 增量估算 |
| 新建 | `src/context/light-compressor.ts` | F1-F3 轻量预防，纯函数 |
| 新建 | `src/context/heavy-compressor.ts` | F4-F10 重量兜底，摘要 prompt + 熔断 |
| 新建 | `src/context/manager.ts` | ContextManager，统一入口 |
| 新建 | `src/context/index.ts` | 模块导出 |
| 新建 | `src/__tests__/context/` | 压缩逻辑的单元测试 |
| 修改 | `src/agent/types.ts` | AgentEvent 联合类型增加 CompressEvent |
| 修改 | `src/agent/loop.ts` | 注入 ContextManager |
| 修改 | `src/chat/chat-service.ts` | 解析 /compress 命令，初始化 ContextManager |

## T1: 类型定义

**文件：** `src/context/types.ts`
**依赖：** 无
**步骤：**
1. 定义 `CompressEvent` 接口：`type: "compress"`，`action` 枚举四个值，可选字段 `message`、`path`、`savedTokens`、`summary`
2. 定义 `TokenAnchor` 接口：`inputTokens: number`、`messageIndex: number`
3. 定义 `CompressedResult` 接口：`result: ToolResult`、`stored: boolean`、`filePath?: string`

**验证：** `npx tsc --noEmit src/context/types.ts` 编译通过

## T2: ContextStore 持久化

**文件：** `src/context/store.ts`
**依赖：** T1
**步骤：**
1. 实现 `saveResult(sessionId, content, meta)` — 写入 `~/.Codia/context/<sessionId>/result_<timestamp>.json`（时间戳格式用 ISO 8601 可排序形式，如 `2026-06-16T10-30-00Z`）
2. 文件内容为 JSON：`{ meta, content }`，`meta` 含 `type` 和 `timestamp`
3. 自动创建目录（`mkdirSync recursive`）
4. 返回写入的绝对路径
5. 实现 `loadResult(filePath)` — 同步读取 JSON 文件，返回 `content` 字段

**验证：** `npx tsc --noEmit src/context/store.ts` 编译通过

## T3: TokenEstimator 估算器

**文件：** `src/context/token-estimator.ts`
**依赖：** T1
**步骤：**
1. 实现 `estimateTokens(text)` — `Math.ceil(text.length / 4)`
2. 实现 `setAnchor(usage, messageCount)` — 保存锚点
3. 实现 `estimate(messages)`：
   - 无锚点 → 全量按 `总字符数 ÷ 4` 估算
   - 有锚点 → 锚点值 + (锚点之后新增消息字符数 ÷ 4)
4. 字符数计算遍历每条消息的 `content` 字段，跳过 `role === "system"` 的消息（固定开销不参与估算），不包含 `timestamp` 等元数据

**验证：** `npx tsc --noEmit src/context/token-estimator.ts` 编译通过

## T4: LightCompressor 轻量压缩

**文件：** `src/context/light-compressor.ts`
**依赖：** T2
**步骤：**
1. 实现 `compressResult(result)`：
   - 若 `result.content.length > 50_000` → 调用 `saveResult()` 存盘，构造预览消息（前 500 字符 + 路径 + token 估算）
   - 否则 → 返回原结果，`stored: false`
2. 实现 `compressBatch(results)`：
   - 先逐个 `compressResult`
   - 计算合并后总字符数
   - 若 > 200K → 按结果大小降序排列，循环存盘直到 < 200K
   - 返回处理后的结果数组
3. 实现 `createPreview(result, filePath)` — 生成预览字符串

**验证：** `npx tsc --noEmit src/context/light-compressor.ts` 编译通过

## T5: HeavyCompressor 重量兜底

**文件：** `src/context/heavy-compressor.ts`
**依赖：** T2, T3, T1
**步骤：**
1. 实现 `buildSummaryPrompt(messagesToSummarize)` — 生成系统提示
2. 实现 `splitMessages(messages, keepTokens, keepMinMessages)` — 从尾部往回切分
3. 实现 `compress()` — 检查熔断、切分、调用 LLM、提取 `<summary>`、存盘、构造新 messages
4. 实现 `isFused()` → 返回 `failureCount >= 3`

**验证：** `npx tsc --noEmit src/context/heavy-compressor.ts` 编译通过

## T6: ContextManager 统一入口

**文件：** `src/context/manager.ts`
**依赖：** T3, T4, T5
**步骤：**
1. 构造函数接收 `provider`、`chatConfig`、`sessionId`、可选 `onEvent`。preRequest 接受可选的 `signal` 参数，传递给 HeavyCompressor
2. 实例化 `TokenEstimator` 和 `HeavyCompressor`
3. 实现 `preRequest(messages, mode, signal?)`：
   - `auto` 模式 → 阈值 187K（200K - 13K），超阈值才压缩
   - `manual` 模式 → 不检查阈值，直接触发压缩，保留余量 3K
4. 实现 `compressToolResults(results, messages)` — 委托给 LightCompressor
5. 实现 `setAnchor(usage, messageCount)` — 委托给 TokenEstimator

**验证：** `npx tsc --noEmit src/context/manager.ts` 编译通过

## T7: 模块导出

**文件：** `src/context/index.ts`
**依赖：** T6
**步骤：**
1. 导出 `ContextManager`、`TokenEstimator`、`HeavyCompressor`、LightCompressor 函数、`ContextStore` 函数
2. 导出类型 `CompressEvent`、`TokenAnchor`、`CompressedResult`

**验证：** `npx tsc --noEmit src/context/` 全部编译通过

## T8: AgentEvent 扩展

**文件：** `src/agent/types.ts`
**依赖：** T1
**步骤：**
1. 导入 `CompressEvent`
2. 将 `CompressEvent` 加入 `AgentEvent` 联合类型

**验证：** `npx tsc --noEmit src/agent/types.ts` 编译通过

## T9: AgentLoop 集成

**文件：** `src/agent/loop.ts`
**依赖：** T6, T8
**步骤：**
1. `AgentLoop` 构造函数增加可选 `contextManager` 参数
2. 在 `provider.streamChat` 前调用 `preRequest`
3. `streamChat` 返回后用 usage 更新锚点
4. 工具结果合并前调用 `compressToolResults`
5. 压缩事件随 AgentEvent 流 yield 出去

**验证：** `npx tsc --noEmit src/agent/` 编译通过

## T10: /compress 命令解析

**文件：** `src/chat/chat-service.ts`
**依赖：** T6
**步骤：**
1. 添加 `/compress` 命令识别
2. 命中后调用 `contextManager.preRequest(messages, "manual")`，直接触发压缩（不检查阈值）
3. 替换 `this.messages` 为压缩后的消息数组，yield CompressEvent
4. 初始化 ContextManager 并传入 `AgentLoop`
5. `onUsage` 回调中更新 `contextManager.setAnchor()`

**验证：** `npx tsc --noEmit src/chat/` 编译通过

## T11: 单元测试

**文件：** `src/__tests__/context/`
**依赖：** T1-T10
**步骤：**
1. `light-compressor.test.ts` — 单结果截断、批量截断、预览格式
2. `token-estimator.test.ts` — 无锚点估算、有锚点增量、estimateTokens
3. `heavy-compressor.test.ts` — splitMessages 切分、buildSummaryPrompt、失败计数、熔断
4. `store.test.ts` — 写入/读取、路径格式、目录创建

**验证：** `pnpm test` 全部通过

## 执行顺序

```
T1 ──→ T2 ──→ T4 ──→ T5 ──→ T6 ──→ T7 ──→ T9 ──→ T10 ──→ T11
  └─→ T3 ──┘                        ↘
                                     (T8 可与 T3-T7 并行)
```
