# Worktree 隔离 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

### 模块 A — WorktreePath
- [ ] `WorktreePath.validate()` 可通过合法名构造（验证：`npx vitest src/__tests__/worktree/path-validator.test.ts` 合法名 case 全部通过）
- [ ] `WorktreePath.validate()` 拒绝非法名并返回正确 errorCode（验证：同上，非法名 case 全部通过）
- [ ] `flatSlug` 将 `/` 正确替换为 `+`（验证：`sub/agent-x` → `sub+agent-x`）（验证：同上，嵌套名 case）
- [ ] `branchName` 格式为 `worktree-{flatSlug}`（验证：同上）

### 模块 B — RealGitWorktreeOps
- [ ] `addWorktree` 使用 `-B` 标志且 branch、path、baseBranch 参数正确（验证：`npx vitest src/__tests__/worktree/git-ops.test.ts` 全部通过）
- [ ] `hasUncommittedChanges` 在有/无未提交文件时正确返回（验证：同上）
- [ ] `getCommitCountAhead` 在新 commit 后返回正确数量（验证：同上）
- [ ] `removeWorktree` 后 worktree 列表不含该条目（验证：同上）
- [ ] `getHooksPath` 返回正确的 hooks 路径或 null（验证：同上）

### 模块 C — WorktreeInitializer
- [ ] 配置文件（.claude/、CLAUDE.md）已复制到 worktree 目录（验证：`npx vitest src/__tests__/worktree/initializer.test.ts` 全部通过）
- [ ] `node_modules/` 以软链接形式存在（验证：同上）
- [ ] hooks 目录内容正确复制（验证：同上）
- [ ] `core.hooksPath` 为 null 时回退到 `<gitdir>/hooks/`（验证：同上）

### 模块 D — WorktreeCreator
- [ ] 创建后 worktree 目录存在且分支正确（验证：`npx vitest src/__tests__/worktree/creator.test.ts` 全部通过）
- [ ] 重复创建同一 name 幂等，不重复调 `git worktree add`（验证：同上）
- [ ] 初始化失败时执行回滚（`removeWorktree` 被调用）（验证：同上）
- [ ] `.codia/` 不在 `.gitignore` 中时自动添加（验证：同上）

### 模块 E — WorktreeCleaner
- [ ] 匹配 autoPatterns 的过期干净目录被清理（验证：`npx vitest src/__tests__/worktree/cleaner.test.ts` 全部通过）
- [ ] 不匹配 autoPatterns 的手动目录即使过期也跳过（验证：同上）
- [ ] 匹配但有未提交修改的过期目录跳过（验证：同上）
- [ ] 三层过滤顺序为：命名 → 过期 → 变更（验证：同上）

### 模块 F — WorktreeManager
- [ ] `enter()` 返回绝对路径 cwd，进程 cwd 不变（验证：`npx vitest src/__tests__/worktree/manager.test.ts` 全部通过）
- [ ] `exit()` 无变更时正常删除 worktree（验证：同上）
- [ ] `exit()` 有变更时拒绝删除（无 force）（验证：同上）
- [ ] `exit()` 有变更 + force 时正常删除（验证：同上）
- [ ] `exit()` keep=true 保留目录（验证：同上）

### Agent 集成点
- [ ] `AgentRoleFrontmatter` 包含 `isolation` 字段（验证：`npx tsc --noEmit` 编译通过）
- [ ] 角色 loader 正确解析 `isolation: worktree`（验证：`npx vitest src/__tests__/agent/role/` 无回归）
- [ ] isolation worktree 角色启动时自动创建隔离目录（验证：`npx vitest src/__tests__/agent/sub-agent-runner.test.ts` 新增 case 全部通过）
- [ ] 子 Agent prompt 中包含上下文通知文本（含路径翻译指引）（验证：同上）
- [ ] 子 Agent cwd 指向 worktree 路径（验证：同上）
- [ ] 无变更时 worktree 自动清理（验证：同上）
- [ ] 操作不存在的 worktree 名称时返回 WorktreeNotFoundError（验证：manager.test.ts 中错误 case）
- [ ] 未声明 isolation 的角色行为不变（验证：全部已有测试无回归）

## 集成

- [ ] `WorktreeManager.enter()` 正确调用 `WorktreeCreator.create()` 链（验证：manager.test.ts 中 enter 流程通过）
- [ ] `WorktreeManager.exit()` 正确调用 `GitWorktreeOps` 删除链（验证：manager.test.ts 中 exit 流程通过）
- [ ] `WorktreeManager.getCleaner()` 返回 `WorktreeCleaner` 实例供外部调用（验证：编译通过 + 类型正确）
- [ ] AgentTool → SubAgentRunner → WorktreeManager 全链路无误（验证：sub-agent-runner.test.ts 新增 case 全部通过）
- [ ] 生命周期操作产生日志（创建/进入/退出/删除均有日志输出）（验证：运行测试时确认日志输出存在）

## 编译与测试

- [ ] 项目编译无错误（验证：`npx tsc --noEmit` 退出码 0）
- [ ] 所有单元测试通过（验证：`pnpm test` 退出码 0）
- [ ] 所有已有测试无回归（验证：`pnpm test` 全部通过）

## 端到端场景

- [ ] 场景 1 — 隔离创建与使用：
  1. 准备一个含 `isolation: worktree` 的角色定义
  2. 通过 AgentTool 触发子 Agent 创建
  3. 观察到 `~/.codia/projects/<project-id>/worktrees/agent-a<hex>/` 目录生成
  4. 子 Agent 的工具调用发生在该目录
  5. 子 Agent 完成后无变更自动删除

- [ ] 场景 2 — 变更保护：
  1. 创建隔离 worktree
  2. 在 worktree 中手动创建文件并 commit
  3. 尝试删除 → 观察被拒绝，返回原因含 "N commits ahead"
  4. 使用 force 删除 → 观察到目录和分支均被清理

- [ ] 场景 3 — 路径校验：
  1. 尝试以 `../escape` 作为 name 创建 → 返回错误，不创建任何目录
  2. 尝试以 `my agent` 作为 name 创建 → 返回字符集错误
  3. 尝试以 `.` 作为 name 创建 → 返回 path_traversal 错误

- [ ] 场景 4 — 后台清理：
  1. 手动在 `~/.codia/projects/<project-id>/worktrees/` 下创建 `agent-a-expired`（修改时间设为 48 小时前）
  2. 创建 `my-saved-work`（修改时间设为 48 小时前）
  3. 调用 cleaner.cleanup({ cutoffDate: 24h前, autoPatterns: ["agent-a*", "wf_*"] })
  4. 观察到 agent-a-expired 被清理，my-saved-work 保留

- [ ] 场景 7 — 旧目录迁移：
  1. 在 `<repoRoot>/.codia/worktrees/` 下准备一个已注册的历史 worktree
  2. 执行 `/worktree migrate`
  3. 观察到该 worktree 被移动到 `~/.codia/projects/<project-id>/worktrees/`
  4. 再次执行 `/worktree migrate` 时提示没有可迁移项

- [ ] 场景 5 — 环境初始化：
  1. 创建隔离 worktree
  2. 进入 worktree 目录
  3. 验证 `.claude/` 配置存在
  4. 验证 `CLAUDE.md` 存在
  5. 验证 `node_modules` 为软链接且可用

- [ ] 场景 6 — 回滚处理：
  1. 模拟初始化过程抛异常（如 symlink 目标不存在）
  2. 观察到 `removeWorktree` 被调用清理半成品
  3. 若 removeWorktree 也失败，观察到严重错误日志输出，目录路径被明确记录
