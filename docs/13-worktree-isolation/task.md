# Worktree 隔离 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/worktree/types.ts` | 全部接口与类型定义 |
| 新建 | `src/worktree/path-validator.ts` | WorktreePath 值对象 + 校验 |
| 新建 | `src/worktree/git-ops.ts` | RealGitWorktreeOps 实现 |
| 新建 | `src/worktree/initializer.ts` | WorktreeInitializer 环境初始化 |
| 新建 | `src/worktree/creator.ts` | WorktreeCreator 创建 + 幂等 + 回滚 |
| 新建 | `src/worktree/cleaner.ts` | WorktreeCleaner 过期清理 |
| 新建 | `src/worktree/manager.ts` | WorktreeManager 编排器 |
| 新建 | `src/worktree/index.ts` | 统一导出 |
| 修改 | `src/agent/role/types.ts` | AgentRoleFrontmatter 加 isolation |
| 修改 | `src/agent/role/loader.ts` | 解析 isolation 字段 |
| 修改 | `src/agent/sub-agent-runner.ts` | 注入 worktree 创建/通知文本/cwd |
| 修改 | `src/agent/agent-tool.ts` | 解析 isolation 参数 |
| 新建 | `src/__tests__/worktree/path-validator.test.ts` | 校验器测试 |
| 新建 | `src/__tests__/worktree/git-ops.test.ts` | Git 操作测试 |
| 新建 | `src/__tests__/worktree/initializer.test.ts` | 初始化器测试 |
| 新建 | `src/__tests__/worktree/creator.test.ts` | 创建器测试 |
| 新建 | `src/__tests__/worktree/cleaner.test.ts` | 清理器测试 |
| 新建 | `src/__tests__/worktree/manager.test.ts` | 编排器测试 |

---

## T1: 定义所有类型与接口

**文件：** `src/worktree/types.ts`
**依赖：** 无

**步骤：**
1. 定义 `WorktreeConfig` 接口（repoRoot, baseBranch, worktreesDir, copyPatterns, symlinkDirs）
2. 定义 `WorktreeInfo` 接口（name, path, branch, headCommit, createdAt, lastActivityAt, isClean, commitCountAhead）
3. 定义 `CleanupConfig` 接口（cutoffDate, autoPatterns）
4. 定义 `CleanupResult` 接口（cleaned, skipped）
5. 定义 `ExitResult` 接口（action, path, info, warning?）
6. 定义 `GitWorktreeOps` 接口（全部方法签名）
7. 定义 `ValidationError` 类（code + field）

**验证：** `npx tsc --noEmit` 编译通过

---

## T2: 实现 WorktreePath 值对象

**文件：** `src/worktree/path-validator.ts`
**依赖：** T1

**步骤：**
1. 实现 `WorktreePath` 类：name, flatSlug, branchName, fsPath 四个只读字段
2. 构造函数 private，接收 WorktreeConfig + 已校验 name
3. `flatSlug` = name.replace(/\//g, "+")
4. `branchName` = `"worktree-" + flatSlug`
5. `fsPath` = join(worktreesDir, name)
6. 实现 `static validate(input: string, config: WorktreeConfig): WorktreePath`
7. 实现 `static isValid(input: string): boolean`
8. validate 按顺序校验：空 → 长度 > 64 → 字符集 [a-zA-Z0-9._/-] → 头尾 / → // → 独立段 . 或 ..

**验证：** `npx tsc --noEmit` 编译通过

---

## T3: 测试 WorktreePath

**文件：** `src/__tests__/worktree/path-validator.test.ts`
**依赖：** T2

**步骤：**
1. 测试合法名 `agent-a3f2b1c` 通过
2. 测试嵌套名 `sub/agent-x` 通过，flatSlug 为 `sub+agent-x`
3. 测试拒绝：`../escape` → path_traversal
4. 测试拒绝：`./foo` → path_traversal
5. 测试拒绝：`/absolute` → absolute_path
6. 测试拒绝：`a//b` → empty_segment
7. 测试拒绝：`.` 独立段 → path_traversal
8. 测试拒绝：`..` 独立段 → path_traversal
9. 测试拒绝：65 字符名 → too_long
10. 测试拒绝：非法字符 `hello world` → invalid_chars
11. 测试 `isValid()` 方法

**验证：** `npx vitest src/__tests__/worktree/path-validator.test.ts` 全部通过

---

## T4: 实现 RealGitWorktreeOps

**文件：** `src/worktree/git-ops.ts`
**依赖：** T1

**步骤：**
1. 实现 `RealGitWorktreeOps` 类，实现 `GitWorktreeOps` 接口
2. 构造函数记录 repoRoot
3. `addWorktree`: `git worktree add -B <branch> <path> <baseBranch>`，cwd 为 repoRoot
4. `removeWorktree`: `git worktree remove [--force] <path>`
5. `deleteBranch`: `git branch -D <branch>`
6. `getBranchName`: `git -C <path> branch --show-current`
7. `getHeadCommit`: `git -C <path> rev-parse HEAD`
8. `hasUncommittedChanges`: `git -C <path> status --porcelain` 输出非空
9. `getCommitCountAhead`: `git -C <path> rev-list --count <base>..HEAD`
10. `listWorktrees`: `git worktree list --porcelain` 解析 worktree 行
11. `getLastModified`: `git -C <path> log -1 --format=%ct` 转 Date
12. `getHooksPath`: `git config core.hooksPath` 返回路径或 null

**验证：** `npx tsc --noEmit` 编译通过

---

## T5: 测试 RealGitWorktreeOps

**文件：** `src/__tests__/worktree/git-ops.test.ts`
**依赖：** T4

**步骤：**
1. 在测试用临时 git 仓库中创建 ops 实例
2. 测试 `addWorktree` 后 `listWorktrees` 包含新 worktree
3. 测试 `getBranchName` 返回正确分支名
4. 测试 `hasUncommittedChanges` 在新文件存在/不存在时正确返回
5. 测试 `getCommitCountAhead` 新 commit 后返回 > 0
6. 测试 `removeWorktree` 后 `listWorktrees` 不含该 worktree
7. 测试 `getHooksPath` 返回正确配置

**验证：** `npx vitest src/__tests__/worktree/git-ops.test.ts` 全部通过

---

## T6: 实现 WorktreeInitializer

**文件：** `src/worktree/initializer.ts`
**依赖：** T1, T4

**步骤：**
1. 实现 `WorktreeInitializer` 类，构造函数接收 WorktreeConfig + GitWorktreeOps
2. `initialize(targetPath, repoRoot)` 方法
3. copyPatterns 处理：对每个 pattern，用 `glob` 匹配主目录文件，`fs.cp` 复制到 targetPath
4. hooks 处理：调用 `ops.getHooksPath(repoRoot)`，存在则复制该目录内容；不存在则获取 `git rev-parse --git-dir`，复制 `<gitdir>/hooks/`
5. symlinkDirs 处理：对每个目录，在 targetPath 创建软链指向主目录，失败则 `fs.cp` 复制
6. 复制/链接操作后 logger 记录

**验证：** `npx tsc --noEmit` 编译通过

---

## T7: 测试 WorktreeInitializer

**文件：** `src/__tests__/worktree/initializer.test.ts`
**依赖：** T6

**步骤：**
1. 创建 mock GitWorktreeOps（含 getHooksPath）
2. 创建临时主目录含 .claude/ 配置、node_modules/、CLAUDE.md
3. 调用 initialize → 验证 targetPath 下存在 .claude/ 副本
4. 验证 node_modules 为软链接
5. 验证 hooks 已复制
6. 测试 hooksPath 为 null 时回退到 `<gitdir>/hooks/`

**验证：** `npx vitest src/__tests__/worktree/initializer.test.ts` 全部通过

---

## T8: 实现 WorktreeCreator

**文件：** `src/worktree/creator.ts`
**依赖：** T1, T4, T6

**步骤：**
1. 实现 `WorktreeCreator` 类，注入 WorktreeConfig + GitWorktreeOps + WorktreeInitializer
2. `create(wp: WorktreePath): Promise<WorktreeInfo>`
3. 确保 `worktreesDir` 存在：`fs.mkdirSync(worktreesDir, { recursive: true })`
4. 幂等检测：检查目标路径是否存在 + `listWorktrees` 中是否已有 → 是则读取现有 Info 返回
5. 确保 `.codia/` 在 `.gitignore` 中：`git check-ignore -q .codia/` 不通过则追加并 commit
6. `ops.addWorktree(path, branch, config.baseBranch)`
7. 记录 headCommit = `ops.getHeadCommit(path)`
8. `initializer.initialize(path, config.repoRoot)`
9. try/catch：步骤 6 后任何失败 → `ops.removeWorktree(path, true)` 回滚；若回滚也失败 → 记录严重错误日志 + 尝试 `git worktree prune` + 输出手动清理提示
10. 返回 WorktreeInfo

**验证：** `npx tsc --noEmit` 编译通过

---

## T9: 测试 WorktreeCreator

**文件：** `src/__tests__/worktree/creator.test.ts`
**依赖：** T8

**步骤：**
1. 用 mock ops + mock initializer 构造 Creator
2. 测试正常创建流程：mock ops.addWorktree + ops.getHeadCommit + initializer.initialize 均被调用
3. 测试幂等：连续两次 create 同一 name，ops.addWorktree 只调用一次
4. 测试回滚：initializer.initialize 抛异常时，ops.removeWorktree 被调用
5. 测试 .codia/ 入 gitignore：模拟 check-ignore 失败 → 验证写入 .gitignore

**验证：** `npx vitest src/__tests__/worktree/creator.test.ts` 全部通过

---

## T10: 实现 WorktreeCleaner

**文件：** `src/worktree/cleaner.ts`
**依赖：** T1, T4

**步骤：**
1. 实现 `WorktreeCleaner` 类，注入 WorktreeConfig + GitWorktreeOps
2. `cleanup(cfg: CleanupConfig): Promise<CleanupResult>`
3. 列出 worktreesDir 下所有子目录
4. ① 命名模式过滤：每个子目录 baseName 匹配 autoPatterns 中任一 glob
5. ② 过期检查：`ops.getLastModified(path)` < cutoffDate
6. ③ 变更保护：`ops.hasUncommittedChanges(path)` 或 `getCommitCountAhead` > 0 → skip
7. 通过三层过滤的：`ops.removeWorktree(path, true)` + `ops.deleteBranch(branch)`
8. 返回 CleanupResult

**验证：** `npx tsc --noEmit` 编译通过

---

## T11: 测试 WorktreeCleaner

**文件：** `src/__tests__/worktree/cleaner.test.ts`
**依赖：** T10

**步骤：**
1. 用 mock ops 创建 Cleaner，worktreesDir 下有 4 个假目录：`agent-a1`, `agent-a2`, `my-manual`, `wf_task`
2. autoPatterns = ["agent-a*", "wf_*"]
3. mock ops 对 agent-a1 设置: lastModified 过期 + 干净 → 应被清理
4. mock ops 对 agent-a2 设置: lastModified 过期 + hasUncommittedChanges → skip
5. mock ops 对 my-manual 设置: 过期 + 干净 → skip（命名不匹配）
6. 验证 cleanupResult.cleaned = ["agent-a1"]，skipped 含 agent-a2(变更) 和 my-manual(命名)

**验证：** `npx vitest src/__tests__/worktree/cleaner.test.ts` 全部通过

---

## T12: 实现 WorktreeManager

**文件：** `src/worktree/manager.ts`
**依赖：** T1, T8, T10

**步骤：**
1. 实现 `WorktreeManager` 类，注入 WorktreeConfig + GitWorktreeOps，内部创建 Creator、Initializer、Cleaner
2. `enter(name): Promise<{ cwd: string; info: WorktreeInfo }>`：调用 Creator.create，返回 cwd(fsPath) 和 info
3. `exit(name, opts?): Promise<ExitResult>`：获取 Info → keep=true 直接返回 → 检查变更 → 无 force 则拒绝 → removeWorktree + deleteBranch
4. `delete(name, force?): Promise<void>`：直接 force 删除
5. `info(name): Promise<WorktreeInfo>`：通过 Creator.create(幂等) 获取
6. `list(): Promise<WorktreeInfo[]>`：列出 worktreesDir 下所有
7. `getCleaner(): WorktreeCleaner`：暴露 cleaner 供外部定时调用

**验证：** `npx tsc --noEmit` 编译通过

---

## T13: 测试 WorktreeManager

**文件：** `src/__tests__/worktree/manager.test.ts`
**依赖：** T12

**步骤：**
1. 用 mock ops 创建 Manager
2. 测试 enter 返回正确的 cwd 和 info
3. 测试 exit 无变更时正常删除
4. 测试 exit 有变更时拒绝（无 force）
5. 测试 exit 有变更 + force 时正常删除
6. 测试 exit keep=true 保留目录
7. 测试 list 返回所有 worktree

**验证：** `npx vitest src/__tests__/worktree/manager.test.ts` 全部通过

---

## T14: 创建 barrel 导出

**文件：** `src/worktree/index.ts`
**依赖：** T2, T4, T6, T8, T10, T12

**步骤：**
1. 导出所有公开类型（WorktreeConfig, WorktreeInfo, CleanupConfig, CleanupResult, ExitResult, GitWorktreeOps）
2. 导出 WorktreePath
3. 导出 WorktreeManager
4. 导出 WorktreeCleaner
5. 导出 RealGitWorktreeOps

**验证：** `npx tsc --noEmit` 编译通过

---

## T15: 扩展 AgentRoleFrontmatter

**文件：** `src/agent/role/types.ts`
**依赖：** 无

**步骤：**
1. `AgentRoleFrontmatter` 接口新增 `isolation?: "worktree"` 字段
2. 值仅允许 `"worktree"`，类型层面约束

**验证：** `npx tsc --noEmit` 编译通过

---

## T16: 解析 isolation 字段

**文件：** `src/agent/role/loader.ts`
**依赖：** T15

**步骤：**
1. `parseRoleFile()` 中，frontmatter 对象新增 `isolation` 字段读取
2. 校验：仅允许 `undefined` 或 `"worktree"`
3. 写入 `AgentRoleFrontmatter` 对象

**验证：** 现有角色测试通过，`npx vitest src/__tests__/agent/role/` 无回归

---

## T17: SubAgentRunner Worktree 集成

**文件：** `src/agent/sub-agent-runner.ts`
**依赖：** T12, T16

**步骤：**
1. `SubAgentRunner.run()` 开头检查 `config.role?.frontmatter.isolation === "worktree"`
2. 若是：构造 WorktreeConfig（repoRoot 从 config.cwd 取，baseBranch 默认 "main"）
3. 创建 `RealGitWorktreeOps` 和 `WorktreeManager`
4. 生成 name：`agent-<randomHex6>` 格式（匹配 `agent-a*` 清理模式）
5. `manager.enter(name)` 获取 worktreeCwd
6. 替换 `config.cwd = worktreeCwd`
7. 拼接通知文本到 `config.prompt` 前面：

   > 你在一个隔离的 Git Worktree 中工作。工作目录：`<worktreeCwd>`。
   > - 父 Agent 传来的文件路径指向主工作目录，请翻译为你本地的对应路径
   > - 在编辑任何文件之前，必须重新读取该文件以确保你看到的是最新内容
   > - 完成后，你的所有改动都在此隔离目录中，父 Agent 会决定是否合并

8. `run()` 结束后的 finally 块：
   - 检查 worktree 变更状态
   - 有变更 → `manager.exit(name, { keep: true })`
   - 无变更 → `manager.exit(name, { force: true })`
   - exit 失败时记录错误日志（不阻塞子 Agent 结果返回）

**验证：** `npx tsc --noEmit` 编译通过

---

## T18: AgentTool 透传隔离参数

**文件：** `src/agent/agent-tool.ts`
**依赖：** T17

**步骤：**
1. `execute()` 中 `isolation` 参数已存在于 inputSchema（预留的 "worktree"）
2. 确保 `isolation` 参数值透传到 `SubAgentConfig`（不做额外处理）
3. 实际的 worktree 创建和管理逻辑在 T17 的 SubAgentRunner 中根据 `role.frontmatter.isolation` 决策
4. AgentTool 的 isolation 参数后续可用作外部覆盖（当前阶段仅透传，不做覆盖逻辑）

**验证：** `npx tsc --noEmit` 编译通过

---

## T19: 联调测试 — Agent 隔离创建全链路

**文件：** `src/__tests__/agent/sub-agent-runner.test.ts`（追加）
**依赖：** T18

**步骤：**
1. 在已有 sub-agent-runner.test.ts 中追加 worktree 隔离测试 case
2. 构造含 `isolation: "worktree"` 的 mock AgentRole
3. 调用 SubAgentRunner.run()
4. 验证 prompt 中包含通知文本
5. 验证 cwd 指向 worktree 路径（非原始 cwd）
6. 验证完成后 worktree 目录状态正确

**验证：** `npx vitest src/__tests__/agent/sub-agent-runner.test.ts` 全部通过

---

## 执行顺序

```
T1 ──→ T2 ──→ T3
 │      │
 │      └──→ T14（最后）
 │
 ├──→ T4 ──→ T5
 │     │
 │     ├──→ T6 ──→ T7
 │     │     │
 │     │     └──→ T8 ──→ T9
 │     │             │
 │     │             └──→ T12 ──→ T13
 │     │
 │     └──→ T10 ──→ T11
 │             │
 │             └──→ T12（T8+T10 均就绪后）
 │
 └──→ T15 ──→ T16
              │
              └──→ T17 ──→ T18 ──→ T19
                    ↑
                  T12 ──→ T14
```

T3、T5、T7、T9、T11、T13 可分别在对应实现完成后并行执行测试编写。

T15（frontmatter 加字段）可与 T1-T14 并行进行。
