# 上下文压缩 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] 所有 7 个新文件（types.ts、store.ts、token-estimator.ts、light-compressor.ts、heavy-compressor.ts、manager.ts、index.ts）编译通过（验证：`npx tsc --noEmit src/context/`）
- [ ] 修改后的 agent/loop.ts、agent/types.ts、chat/chat-service.ts 与原代码兼容（验证：`npx tsc --noEmit` 全项目编译通过）

## 轻量预防 (F1-F3)

- [ ] F1 单结果截断：传入 `content.length = 60K` 的 ToolResult，验证返回的 content 仅含前 500 字符 + 文件路径 + token 估算，原内容已写入磁盘文件（验证：运行单元测试，断言 `stored: true` 且 `filePath` 指向存在的文件）
- [ ] F1 不截断小结果：传入 `content.length = 10K` 的 ToolResult，验证返回原结果不变且 `stored: false`（验证：运行单元测试）
- [ ] F2 批量截断：3 个结果分别为 80K、80K、80K，合并 240K > 200K，验证输出中至少 1 个被存盘替换，合计字符数 < 200K（验证：运行单元测试）
- [ ] F3 用户消息不参与压缩：构造混合 messages 数组（含 user 消息和 tool result），调用 `compressToolResults`，验证返回的 results 中所有 user 消息的 content 未被修改（验证：运行单元测试）

## 重量兜底 (F4-F10)

- [ ] F4 自动触发：构造 token 估算 ≥ 187K 的 messages，调用 `preRequest(messages, "auto")`，验证返回的 messages 不同于输入（验证：运行单元测试，断言返回值 ≠ 输入引用）
- [ ] F4 不误触发：构造 token 估算 < 187K 的 messages，调用 `preRequest`，验证返回 messages 不变（验证：运行单元测试）
- [ ] F5 保留窗口：构造 20 条消息，第 15-20 条约 12K token，验证 `splitMessages` 返回的 `recent` 包含后 5 条且 `old` 包含前 15 条（验证：运行单元测试）
- [ ] F6 摘要结构：调用 `buildSummaryPrompt`，验证返回的 prompt 文本包含五个部分的标题（验证：运行单元测试，检查字符串包含关系）
- [ ] F7 Prompt 约束：验证 `buildSummaryPrompt` 输出包含"不调用工具"和 `<draft>`/`<summary>` 标签（验证：运行单元测试）
- [ ] F8 边界消息：调用 `compress()` 成功后，验证返回的 messages 中包含一条边界消息（role: "user"，内容含"重新读取"提示），位置在摘要消息之后、保留的近期消息之前（验证：运行单元测试，检查消息 role 和 content 关键词及相对位置）
- [ ] F9 手动触发：调用 `preRequest(messages, "manual")`，验证不检查阈值直接触发压缩，保留余量为 3K（验证：运行单元测试，构造远低于阈值的 messages，断言压缩仍被执行）
- [ ] F10 熔断：连续 3 次 `compress()` 失败后，验证 `isFused()` 返回 `true`，第 4 次调用跳过压缩直接返回原 messages（验证：运行单元测试）

## Token 估算

- [ ] F11 无锚点估算：首次 `estimate([msg1, msg2])`，验证返回值 ≈ `totalChars / 4`（验证：运行单元测试）
- [ ] F11 有锚点增量：`setAnchor({ inputTokens: 5000 }, 10)` 后，新增 3 条消息（共约 4000 字符），验证 `estimate()` ≈ `5000 + 1000`（验证：运行单元测试）
- [ ] F11 estimateTokens 精度：`estimateTokens("hello world")` 返回 `Math.ceil(11/4) = 3`（验证：运行单元测试）
- [ ] F11 估算跳过 system 消息：messages 中包含 system 消息，验证 `estimate(messages)` 不计算 system 消息的字符数（验证：运行单元测试）

## 集成

- [ ] AgentLoop 在 streamChat 前调用 `preRequest`（验证：mock provider，验证调用顺序）
- [ ] AgentLoop 在 streamChat 后用 usage 更新 TokenEstimator 锚点（验证：mock provider 返回 usage，检查 estimator 锚点已更新）
- [ ] AgentLoop 在工具结果合并前调用 `compressToolResults`（验证：mock scheduler 返回大结果，检查结果被截断）
- [ ] `/compress` 命令被 ChatService 正确解析（验证：发送 `/compress`，断言调用了 `preRequest("manual")`）
- [ ] 压缩事件通过 AgentEvent yield 到 TUI 并在终端显示（验证：mock CompressEvent，检查 TUI 可接收并渲染压缩提示消息）

## 编译与测试

- [ ] `pnpm test` 全部通过
- [ ] `pnpm build`（如有）编译无错误
- [ ] `npx tsc --noEmit` 全项目类型检查通过

## 端到端场景

- [ ] 场景 A：持续对话中工具返回超大结果 → 终端可见截断提示 → 对话继续不中断（验证：启动 Codia，连续读取大文件，观察终端输出有"已保存至"提示）
- [ ] 场景 B：长对话接近窗口上限 → 自动触发压缩 → 终端显示"上下文已压缩"→ 对话继续 → 模型仍能正确理解之前的任务（验证：构建长对话历史，观察自动压缩事件）
- [ ] 场景 C：用户主动 `/compress` → 立即触发压缩 → 终端显示压缩结果（验证：在任意对话中输入 `/compress`，观察提示）
- [ ] 场景 D：摘要连续失败 3 次 → 第 4 次不尝试 → 终端显示告警 → 对话继续（验证：mock 摘要调用 3 次失败，验证第 4 次被跳过）
