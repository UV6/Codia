# Team Lead — 主 Agent 升级 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] `src/team/types.ts` 所有类型编译通过（验证：`pnpm exec tsc --noEmit` 无错误）
- [ ] `src/team/team-manager.ts` — TeamManager 创建/加载/保存/删除小组、管理成员（验证：T12 测试全部通过）
- [ ] `src/team/shared-task-board.ts` — SharedTaskBoard 增删查改、依赖过滤（验证：T13 测试全部通过）
- [ ] `src/team/mailbox-system.ts` — MailboxSystem 注册、收发消息、锁机制、广播（验证：T14 测试全部通过）
- [ ] `src/team/member-backend.ts` — MemberBackend 后端检测、派生成员、降级通知（验证：T18 测试全部通过）
- [ ] `src/team/lead-orchestrator.ts` — LeadOrchestrator 目标拆解、派生、合并（验证：T16 测试全部通过）
- [ ] `src/team/coordinator-filter.ts` — CoordinatorFilter 两把锁 + 白名单过滤（验证：T15 测试全部通过）
- [ ] `src/team/team-tools.ts` — 10 个团队协作工具全部实现（验证：T17 测试全部通过）
- [ ] `src/config/index.ts` — AppConfig 含 coordinator 字段（验证：编译通过）
- [ ] `src/agent/tool-filter.ts` — ToolFilterPipeline 含 Coordinator 过滤层（验证：编译通过）
- [ ] `src/chat/chat-service.ts` — 接入 TeamManager 和 CoordinatorFilter（验证：编译通过）

## 集成

- [ ] TeamManager 创建小组后，`~/.codia/teams/<name>/` 目录和 `group.json` 存在（验证：运行 T12 createTeam 测试，检查输出目录）
- [ ] SharedTaskBoard 任务被两个不同实例共享读取（验证：创建 taskBoard1 写任务，taskBoard2 读，内容一致）
- [ ] MailboxSystem 并发写同邮箱不丢消息（验证：T14 并发测试，5 条并发消息全部出现在邮箱文件中）
- [ ] CoordinatorFilter 在 ToolFilterPipeline 中正确串联（验证：构造 config coordinator.enabled=true + CODIA_COORDINATOR=1，write_file/edit_file 被过滤掉）
- [ ] ChatService 启动后，主入口会话看不到 TeamTools（验证：检查 ToolRegistry 注册的工具列表不含 TeamTask* 和 SendMessage）
- [ ] 持久化恢复：创建小组并写入数据后，模拟进程重启（重新 loadTeam），任务板、成员花名册和消息历史仍完整可读（验证：T12 loadTeam 测试 + T14 邮箱恢复测试）
- [ ] 所有公开接口至少被一个真实调用方使用（验证：编译 + 全部测试通过）

## 编译与测试

- [ ] 项目编译无错误（验证：`pnpm exec tsc --noEmit` 退出码 0）
- [ ] 所有新增单元测试通过（验证：`pnpm test src/__tests__/team/` 全部绿色）
- [ ] 已有测试不受影响（验证：`pnpm test` 全部通过，与 main 分支测试数一致或更多）

## 端到端场景

- [ ] **E2E-1（创建小组 + 共享任务）：** 创建小组 "test-team"，添加 2 个 worker 成员，Lead 创建 3 个任务（含依赖关系），worker-A 查询任务列表可看到全部 3 个任务，worker-A 认领一个任务并标记为 in_progress，worker-B 查询时可看到 worker-A 的认领状态
- [ ] **E2E-2（审批流程）：** 创建一个 requiresApproval=true 的成员，该成员发送审批请求消息，Lead 收件箱中出现 approval_request 类型消息，Lead 回复 `{"type": "approval_response", "action": "approved", "planId": "..."}`，成员收到通知继续执行
- [ ] **E2E-3（消息收发）：** worker-A 向 worker-B 发消息，worker-B 收件箱中出现该消息（含时间戳、默认未读），worker-B 标记已读后再次读取收件箱，消息的 read 变为 true
- [ ] **E2E-4（成员空闲恢复）：** worker 完成任务后标记自身空闲并通知 Lead，Lead 再次向该 worker 发任务消息，worker 从磁盘恢复上下文继续工作（验证：worker 不需要重新创建 worktree 环境）
- [ ] **E2E-5（Coordinator 模式）：** 开启 coordinator 模式（配置 + 环境变量），Lead 调用 write_file 工具返回 error（工具不可用），Lead 调用 read_file 和 run_command 正常可用，关闭环境变量后 write_file 恢复正常
- [ ] **E2E-6（git 合并）：** Lead 创建 2 个 worker，各分配任务，worker-A 修改了 file-a.ts 并提交，worker-B 修改了 file-b.ts 并提交，两者无冲突，Lead 执行合并后主分支同时包含两个改动
- [ ] **E2E-7（合并冲突回滚）：** worker-A 和 worker-B 都修改了同一文件的同一行，合并时按创建时间顺序合并，其中先创建的成员合并成功、后创建的成员被回滚，Lead 收到回滚通知
