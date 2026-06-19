# 会话恢复与分层记忆管理 Checklist

> 每一项都应通过运行代码、检查文件结果或观察可见行为来验证，聚焦系统行为而不是实现细节。

## 实现完整性

- [ ] 三层项目指令入口均可被加载，并按“项目根 > 项目私有目录 > 用户目录”的顺序参与注入（验证：对应 instruction loader / resolver 测试通过，并断言拼接顺序正确）
- [ ] `@include` 能正确展开合法引用（验证：对应 instruction resolver 测试通过，并断言展开后的文本包含被引用内容）
- [ ] 循环引用、超深引用、越界引用会被拦截且不会阻止系统启动（验证：对应 instruction resolver 测试通过，并断言 warning 与降级结果正确）
- [ ] 新会话会在项目内 `sessions/` 目录创建 JSONL 文件，文件名符合 `YYYYMMDD-HHMMSS-xxxx` 格式（验证：history 测试通过，并断言生成的会话文件路径与名称）
- [ ] 会话摘要信息直接从 JSONL 文件本身恢复，不依赖独立 meta 文件（验证：history / cleanup 测试通过，并断言标题、消息数、最后活动时间来自实际会话文件）
- [ ] 用户级与项目级记忆索引都能在首轮请求前参与上下文组装（验证：bootstrap / prompt 相关测试通过，并断言两类索引都被纳入组装结果）
- [ ] 自动记忆能按四类之一生成或更新笔记（验证：memory extractor / store 测试通过，并断言生成或更新后的 note 分类正确）

## 集成

- [ ] 启动恢复编排器能够在新会话场景下同时组装项目指令与记忆索引（验证：`src/__tests__/bootstrap/context-builder.test.ts` 通过，并断言组装结果完整）
- [ ] 启动恢复编排器能够在恢复旧会话场景下同时组装历史消息、项目指令与记忆索引（验证：`src/__tests__/bootstrap/context-builder.test.ts` 通过，并断言组装结果完整）
- [ ] `ChatService` 与 CLI 入口会通过显式 bootstrap 入口消费恢复结果，而不是各自直接拼接底层恢复数据（验证：chat / cli 集成测试通过，恢复路径可工作）
- [ ] 恢复流程在检测到上下文超限时只会触发一次压缩（验证：构造超长历史会话，对应恢复与 chat 集成测试通过，并断言不会出现重复压缩）
- [ ] 恢复流程在检测到长时间中断时会插入时间跨度提醒（验证：构造超过阈值的旧会话，对应恢复测试通过，并断言消息序列中存在提醒）
- [ ] 任意一个恢复子模块缺失或局部失败时，系统仍能降级启动（验证：分别制造指令缺失、记忆索引缺失、会话部分损坏，对应 bootstrap / chat 测试通过）

## 编译与测试

- [ ] 项目能够通过类型检查与测试编译（验证：运行 `pnpm test`，无编译错误）
- [ ] 项目指令模块测试全部通过（验证：运行 `pnpm test -- --run src/__tests__/instruction/*.test.ts`）
- [ ] 会话恢复与清理测试全部通过（验证：运行 `pnpm test -- --run src/__tests__/chat/history-recovery.test.ts src/__tests__/chat/session-cleanup.test.ts`）
- [ ] 自动记忆与索引测试全部通过（验证：运行 `pnpm test -- --run src/__tests__/memory/*.test.ts`）
- [ ] 启动编排与 prompt 注入测试全部通过（验证：运行 `pnpm test -- --run src/__tests__/bootstrap/context-builder.test.ts src/__tests__/prompt/bootstrap-sections.test.ts`）

## 端到端场景

- [ ] 场景 1：新建一个带三层 `MEWCODE.md` 和两级记忆索引的项目会话，发送首条消息后，Agent 能直接体现已加载的项目规则与用户偏好（验证：本地启动后观察首轮响应行为）
- [ ] 场景 2：恢复一个包含坏行、长时间中断且历史较长的旧会话，系统仍能恢复到可继续对话的状态，并在必要时给出时间提醒或压缩后的上下文（验证：本地恢复指定会话并观察行为）
- [ ] 场景 3：完成一轮自然结束的对话后，系统异步更新项目级或用户级记忆，再开启下一次新会话时可读到更新后的索引（验证：连续执行“对话结束 → 检查记忆文件 → 新会话读取”流程）
