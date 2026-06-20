# Team Lead — 主 Agent 升级 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/team/types.ts` | TeamConfig、MemberInfo、SharedTask、TeamMessage、ApprovalResponse 等类型定义 |
| 新建 | `src/team/team-manager.ts` | TeamManager 类：小组创建/加载/保存/删除、成员花名册管理 |
| 新建 | `src/team/shared-task-board.ts` | SharedTaskBoard 类：共享任务增删查改、JSON 持久化 |
| 新建 | `src/team/mailbox-system.ts` | MailboxSystem 类：名称注册表、邮箱文件、锁机制、消息收发 |
| 新建 | `src/team/member-backend.ts` | MemberBackend 类：tmux/in-process 后端选择、派生/终止/唤醒成员 |
| 新建 | `src/team/lead-orchestrator.ts` | LeadOrchestrator 类：目标拆解为任务、派生成员、git 合并 |
| 新建 | `src/team/coordinator-filter.ts` | CoordinatorFilter 类：两把锁检测、白名单工具过滤 |
| 新建 | `src/team/team-tools.ts` | createTeamTools 工厂 + 10 个团队协作工具类 |
| 修改 | `src/config/index.ts` | AppConfig 新增 `coordinator?: { enabled: boolean }` |
| 修改 | `src/agent/tool-filter.ts` | ToolFilterPipeline 新增 Coordinator 过滤层 |
| 修改 | `src/chat/chat-service.ts` | 接入 TeamManager 和 CoordinatorFilter |
| 新建 | `src/__tests__/team/team-manager.test.ts` | TeamManager 单元测试 |
| 新建 | `src/__tests__/team/member-backend.test.ts` | MemberBackend 单元测试（含后端检测、降级通知） |
| 新建 | `src/__tests__/team/shared-task-board.test.ts` | SharedTaskBoard 单元测试 |
| 新建 | `src/__tests__/team/mailbox-system.test.ts` | MailboxSystem 单元测试（含锁并发测试） |
| 新建 | `src/__tests__/team/coordinator-filter.test.ts` | CoordinatorFilter 单元测试 |
| 新建 | `src/__tests__/team/lead-orchestrator.test.ts` | LeadOrchestrator 单元测试 |
| 新建 | `src/__tests__/team/team-tools.test.ts` | TeamTools 单元测试 |

## T1: 团队类型定义

**文件：** `src/team/types.ts`
**依赖：** 无
**步骤：**
1. 定义 `TeamConfig` 接口，包含 name、lead、members、createdAt、updatedAt
2. 定义 `MemberInfo` 接口，包含 name、role、workDir、backend、requiresApproval、status、contextDir、sessionId
3. 定义 `SharedTask` 接口，包含 id、title、description、status、assignee、dependencies、createdAt、updatedAt
4. 定义 `TeamMessage` 接口，包含 id、from、to、type、body、timestamp、read、summary
5. 定义 `ApprovalResponse` 接口，包含 type、action、planId、reason
6. 定义 `SpawnResult`、`MergeResult` 接口

**验证：** `pnpm exec tsc --noEmit` 编译通过

## T2: TeamManager 实现

**文件：** `src/team/team-manager.ts`
**依赖：** T1
**步骤：**
1. 实现 `constructor(persistenceRoot)`，默认值为 `~/.codia/teams`
2. 实现 `createTeam(name, leadName)` — 创建目录结构、写 `group.json`（原子写入：先 `.tmp` 再 `rename`）、初始化空成员花名册
3. 实现 `loadTeam(name)` — 读取并解析 `group.json`，文件不存在时抛明确错误
4. 实现 `listTeams()` — 扫描 `persistenceRoot` 下所有子目录，列出有效的 `group.json` 所在目录名
5. 实现 `saveTeam(config)` — 序列化 TeamConfig 并原子写入 `group.json`
6. 实现 `deleteTeam(name)` — 递归删除小组目录
7. 实现 `addMember(name, info)` — 加载 config、push 成员、save
8. 实现 `removeMember(name, memberName)` — 加载 config、过滤成员、save
9. 实现 `updateMemberStatus(name, memberName, status)` — 加载 config、查找并更新成员状态、save

**验证：** `pnpm exec tsc --noEmit` 编译通过 + 运行 T12 测试

## T3: SharedTaskBoard 实现

**文件：** `src/team/shared-task-board.ts`
**依赖：** T1
**步骤：**
1. 实现 `constructor(teamConfig)` — 接收 TeamConfig，确定 `tasks.json` 路径
2. 实现 `load()` 私有方法 — 从 `tasks.json` 读取任务数组，文件不存在返回 `[]`
3. 实现 `save(tasks)` 私有方法 — 原子写入 `tasks.json`
4. 实现 `createTask(task)` — 生成 UUID 作为 id，自动补 createdAt/updatedAt，追加到任务列表并落盘
5. 实现 `getTask(taskId)` — 加载任务列表，按 id 查找
6. 实现 `listTasks(filter?)` — 加载任务列表，按 status/assignee 过滤
7. 实现 `updateTask(taskId, patch)` — 查找任务、合并 patch、更新 updatedAt、落盘
8. 实现 `deleteTask(taskId)` — 过滤删除、落盘
9. 实现 `getReadyTasks()` — 返回 status 为 pending、且所有 dependencies 已完成的任务

**验证：** `pnpm exec tsc --noEmit` 编译通过 + 运行 T13 测试

## T4: MailboxSystem 实现

**文件：** `src/team/mailbox-system.ts`
**依赖：** T1
**步骤：**
1. 实现工具函数 `withFileLock(filePath, fn, maxRetries, lockTtlMs)` — 创建 `.lock` 文件（flag: `wx`）、重试逻辑、过期锁检测、清理
2. 实现 `sleep(ms)` 辅助函数
3. 实现 `constructor(teamConfig)` — 确定 `members/` 目录和 `registry.json` 路径
4. 实现 `ensureDir()` 私有方法 — 确保 `mailbox/` 目录存在
5. 实现 `registerMember(name)` — 在 `registry.json` 中登记 `{ name: "mailbox/<name>.json" }`、创建空邮箱文件
6. 实现 `unregisterMember(name)` — 从注册表中移除
7. 实现 `sendMessage(msg)` — 生成 UUID、自动补 timestamp（ISO 8601）、默认 read=false、通过锁机制追加到收件人邮箱文件
8. 实现 `broadcast(from, body, summary)` — 遍历注册表所有成员，向每人发送一条消息
9. 实现 `readInbox(memberName, markAsRead)` — 读取邮箱文件全部消息、可选标记已读、落盘
10. 实现 `getMessage(memberName, messageId)` — 按 ID 查找单条消息
11. 实现 `markAsRead(memberName, messageId)` — 标记消息已读、落盘

**验证：** `pnpm exec tsc --noEmit` 编译通过 + 运行 T14 测试

## T5: MemberBackend 实现

**文件：** `src/team/member-backend.ts`
**依赖：** T1, T2（加载小组配置）、T4（发送降级/唤醒消息）
**步骤：**
1. 实现 `detectAvailable()` — 执行 `which tmux` 或检查 `$TMUX` 环境变量，返回 `"tmux"` 或 `"in-process"`
2. 实现 `isTmuxAvailable()` — 布尔版本
3. 实现 `spawnMember(teamName, info, subAgentConfig)`:
   a. 为成员创建 worktree（复用 WorktreeManager.enter）
   b. 如果 tmux 可用 → `tmux new-session -d -s <member-session> -c <workdir> "codia --resume <context>"` 或直接启动
   c. 如果 tmux 不可用 → 在进程内复用 SubAgentRunner.runInBackground
   d. 记录降级情况（如有）
   e. 更新成员状态为 active，更新 sessionId
   f. 降级时通过 mailbox 通知 Lead
4. 实现 `stopMember(teamName, memberName)` — tmux: `tmux kill-session -t <session>`；in-process: abort signal
5. 实现 `wakeMember(teamName, memberName)` — tmux: `tmux select-window -t <session>`；in-process: no-op
6. 实现 `getTmuxSessionId(teamName, memberName)` — 从 TeamConfig 获取

**验证：** `pnpm exec tsc --noEmit` 编译通过

## T6: LeadOrchestrator 实现

**文件：** `src/team/lead-orchestrator.ts`
**依赖：** T1, T2, T3, T4, T5
**步骤：**
1. 实现 `constructor(...)` — 注入 TeamManager、SharedTaskBoard、MailboxSystem、MemberBackend、projectRoot
2. 实现 `decomposeGoal(goal)` — 构造 LLM prompt 要求将目标拆为子任务列表（含依赖关系提示），调用 LLM，解析返回的 JSON 数组为 SharedTask[]
3. 实现 `spawnMembersForTasks(tasks)` — 根据任务数量派生成员，每个成员绑定 worktree，返回 SpawnResult[]
4. 实现 `mergeAllWorktrees(teamName)`:
   a. 加载小组配置获取所有成员
   b. 对每个成员的 worktree：`git fetch` + `git merge`
   c. 自动合并：`git merge --no-edit`
   d. 冲突时：`git merge --abort`，记录 MergeResult(status: "rolled_back")
   e. 合并成功：记录 MergeResult(status: "merged")
   f. 汇总返回 MergeResult[]
5. 实现 `rollbackMember(teamName, memberName)` — `git merge --abort` 或 `git reset --hard`

**验证：** `pnpm exec tsc --noEmit` 编译通过 + 运行 T16 测试

## T7: CoordinatorFilter 实现

**文件：** `src/team/coordinator-filter.ts`
**依赖：** T1（Config 类型）
**步骤：**
1. 定义 `COORDINATOR_ALLOWED_TOOLS` 白名单数组
2. 实现 `static isEnabled(config)` — 检查 `config.coordinator?.enabled` 和 `process.env.CODIA_COORDINATOR === "1"`
3. 实现 `static getAllowedTools()` — 返回白名单
4. 实现 `static apply(allTools, config)` — 如果 isEnabled，过滤到白名单；否则原样返回

**验证：** `pnpm exec tsc --noEmit` 编译通过 + 运行 T15 测试

## T8: TeamTools 实现

**文件：** `src/team/team-tools.ts`
**依赖：** T1, T3, T4, T5, T6
**步骤：**
1. 实现 `createTeamTools(taskBoard, mailbox, memberName, isLead, memberBackend?, orchestrator?)` 工厂函数
2. 实现 `TeamTaskListTool` — 调用 `taskBoard.listTasks()` 并格式化返回
3. 实现 `TeamTaskGetTool` — 按 taskId 查询
4. 实现 `TeamTaskCreateTool` — 调用 `taskBoard.createTask()`（仅 Lead 可创建，非 Lead 返回 error）
5. 实现 `TeamTaskUpdateTool` — 调用 `taskBoard.updateTask()`，支持修改 status/assignee/dependencies
6. 实现 `TeamTaskDeleteTool` — 调用 `taskBoard.deleteTask()`（仅 Lead 可删除）
7. 实现 `SendMessageTool` — 调用 `mailbox.sendMessage()`，自动用 memberName 作为 from
8. 实现 `BroadcastMessageTool` — 调用 `mailbox.broadcast()`（仅 Lead 可用）
9. 实现 `ReadInboxTool` — 调用 `mailbox.readInbox(memberName)`
10. 实现 `RequestApprovalTool` — 发送 `type: "approval_request"` 的结构化消息给 Lead
11. 实现 `StopMemberTool` — 调用 `MemberBackend.stopMember()`（仅 Lead 可用）
12. 实现 `MergeWorktreesTool` — 调用 `LeadOrchestrator.mergeAllWorktrees()`（仅 Lead 可用）

**验证：** `pnpm exec tsc --noEmit` 编译通过 + 运行 T17 测试

## T9: Config 类型扩展

**文件：** `src/config/index.ts`
**依赖：** 无
**步骤：**
1. 在 `AppConfig` 接口中新增可选字段 `coordinator?: { enabled: boolean }`
2. 确保向后兼容（字段可选）

**验证：** `pnpm exec tsc --noEmit` 编译通过

## T10: ToolFilterPipeline 扩展

**文件：** `src/agent/tool-filter.ts`
**依赖：** T7
**步骤：**
1. 在 `apply` 静态方法中新增第五层过滤：如果 Coordinator 模式启用，应用 `CoordinatorFilter.apply()`
2. 第五层放在第四层（角色过滤）之后
3. 扩展 `apply` 签名，新增可选参数 `config?: AppConfig`

**验证：** `pnpm exec tsc --noEmit` 编译通过

## T11: ChatService 集成

**文件：** `src/chat/chat-service.ts`
**依赖：** T2, T7, T8
**步骤：**
1. 在 ChatService 构造函数或 create 工厂中初始化 TeamManager
2. 根据当前会话是否为小组成员，决定是否注册团队工具到 ToolRegistry
3. 在 Coordinator 模式启用时，工具注册阶段应用 CoordinatorFilter
4. 确保主入口会话和普通子 Agent（非小组成员）看不到团队协作工具

**验证：** `pnpm exec tsc --noEmit` 编译通过

## T12: TeamManager 测试

**文件：** `src/__tests__/team/team-manager.test.ts`
**依赖：** T2
**步骤：**
1. 使用临时目录作为 `persistenceRoot`（`fs.mkdtemp`）
2. 测试 `createTeam` — 创建后目录和 `group.json` 存在
3. 测试 `loadTeam` — 创建后加载，验证字段一致性
4. 测试 `loadTeam` — 不存在时抛错
5. 测试 `listTeams` — 创建多个小组后，列出的名称数量正确
6. 测试 `addMember` / `removeMember` — 成员正确增删
7. 测试 `updateMemberStatus` — 状态变更落盘
8. 测试 `saveTeam` — 原子写入，`.tmp` 文件在 rename 后不存在
9. 测试 `deleteTeam` — 删除后目录不存在
10. `afterAll` 清理临时目录

**验证：** `pnpm test src/__tests__/team/team-manager.test.ts` 全部通过

## T13: SharedTaskBoard 测试

**文件：** `src/__tests__/team/shared-task-board.test.ts`
**依赖：** T3
**步骤：**
1. 使用临时任务文件路径
2. 测试 `createTask` — 创建后返回含 id 和 timestamp 的完整任务
3. 测试 `getTask` — 按 id 查询，不存在返回 null
4. 测试 `listTasks` — 创建 3 个不同状态的任务，按 status 过滤数量正确
5. 测试 `listTasks` — 按 assignee 过滤数量正确
6. 测试 `updateTask` — 更新状态后重新查询，状态已变更
7. 测试 `deleteTask` — 删除后查询返回 null
8. 测试 `getReadyTasks` — 依赖已完成的任务出现在结果中，依赖未完成的不出现
9. `afterAll` 清理临时文件

**验证：** `pnpm test src/__tests__/team/shared-task-board.test.ts` 全部通过

## T14: MailboxSystem 测试

**文件：** `src/__tests__/team/mailbox-system.test.ts`
**依赖：** T4
**步骤：**
1. 使用临时小组目录
2. 测试 `registerMember` — 注册表中出现映射
3. 测试 `sendMessage` — 消息出现于收件人邮箱，含 timestamp 和 read=false
4. 测试 `broadcast` — 所有注册成员都收到消息
5. 测试 `readInbox` — 返回未读消息；`markAsRead=true` 后消息已读
6. 测试 `getMessage` — 按 messageId 查找
7. 测试 `markAsRead` — 单条标记已读后 read 变为 true
8. **并发测试：** 同时写 5 条消息到同一邮箱，所有消息都成功写入（无丢失）
9. 测试锁过期 — 写入 30 秒前的锁文件，确认自动清理
10. `afterAll` 清理临时目录

**验证：** `pnpm test src/__tests__/team/mailbox-system.test.ts` 全部通过

## T15: CoordinatorFilter 测试

**文件：** `src/__tests__/team/coordinator-filter.test.ts`
**依赖：** T7
**步骤：**
1. 测试 `isEnabled` — 两把锁都开时返回 true
2. 测试 `isEnabled` — 配置关、环境变量开 → false
3. 测试 `isEnabled` — 配置开、环境变量关 → false
4. 测试 `isEnabled` — 两把锁都关 → false
5. 测试 `apply` — 开启后 Write/Edit 不在结果中
6. 测试 `apply` — 开启后 Read/Bash/Agent 在结果中
7. 测试 `apply` — 关闭后所有工具原样返回
8. 测试 `getAllowedTools` — 返回白名单数组

**验证：** `pnpm test src/__tests__/team/coordinator-filter.test.ts` 全部通过

## T16: LeadOrchestrator 测试

**文件：** `src/__tests__/team/lead-orchestrator.test.ts`
**依赖：** T6
**步骤：**
1. Mock LLM 返回固定的任务列表 JSON
2. 测试 `decomposeGoal` — 输入目标文本，返回 SharedTask[] 且任务间有依赖关系
3. 测试 `spawnMembersForTasks` — 返回的 SpawnResult 数量等于任务数量
4. 测试 `mergeAllWorktrees` — 模拟 git merge 成功的情况
5. 测试 `mergeAllWorktrees` — 模拟 git merge 冲突的情况，确认返回 rolled_back
6. 测试 `rollbackMember` — 确认回滚操作被调用

**验证：** `pnpm test src/__tests__/team/lead-orchestrator.test.ts` 全部通过

## T17: TeamTools 测试

**文件：** `src/__tests__/team/team-tools.test.ts`
**依赖：** T8
**步骤：**
1. Mock SharedTaskBoard 和 MailboxSystem
2. 测试 `TeamTaskListTool.execute` — 返回任务列表
3. 测试 `TeamTaskGetTool.execute` — 按 ID 返回任务
4. 测试 `TeamTaskCreateTool.execute` — Lead 调用成功，非 Lead 返回 error
5. 测试 `TeamTaskUpdateTool.execute` — 更新状态成功
6. 测试 `TeamTaskDeleteTool.execute` — Lead 调用成功，非 Lead 返回 error
7. 测试 `SendMessageTool.execute` — 调用 mailbox.sendMessage，from 为 memberName
8. 测试 `BroadcastMessageTool.execute` — 仅 Lead 可用
9. 测试 `ReadInboxTool.execute` — 返回收件箱
10. 测试 `RequestApprovalTool.execute` — 发送消息类型为 approval_request 且 to 为 Lead
11. 测试每个工具的 inputSchema 定义正确

**验证：** `pnpm test src/__tests__/team/team-tools.test.ts` 全部通过

## T18: MemberBackend 测试

**文件：** `src/__tests__/team/member-backend.test.ts`
**依赖：** T5
**步骤：**
1. Mock WorktreeManager 和 MailboxSystem
2. 测试 `detectAvailable()` — tmux 可用时返回 `"tmux"`，不可用时返回 `"in-process"`
3. 测试 `isTmuxAvailable()` — 返回布尔值
4. 测试 `spawnMember` — 创建 worktree 并设置 sessionId
5. 测试降级通知 — tmux 不可用时，向 Lead 发送包含降级原因的消息
6. 测试 `stopMember` — 调用终止逻辑
7. 测试 `wakeMember` — tmux: 执行 select-window；in-process: no-op
8. `afterAll` 清理临时目录

**验证：** `pnpm test src/__tests__/team/member-backend.test.ts` 全部通过

## 执行顺序

```
T1 ──→ T2 ──→ T12
  │
  ├──→ T3 ──→ T13
  │
  ├──→ T4 ──→ T5 ──→ T6 ──→ T8 ──→ T11
  │              │              │       │
  │              │              ▼       ▼
  │              │             T17     (集成完成)
  │              │
  │              └──→ T14 ──→ T18
  │
  ├──→ T7 ──→ T10 ──→ T11
  │     │       │
  │     ▼       ▼
  │    T15    (integrated)
  │
  └──→ T9

(T9 可与 T2-T8 并行)
(T12-T18 测试组可与 T9-T11 集成组并行)
```
