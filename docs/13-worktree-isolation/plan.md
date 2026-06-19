# Worktree 隔离 Plan

## 架构概览

新增 `src/worktree/` 模块，包含 6 个组件：

| 组件 | 职责 |
|------|------|
| **WorktreePath** | 值对象：校验名、规范化、派生平铺 slug 和分支名 |
| **GitWorktreeOps** | 接口抽象：隔离真实 git 调用，便于测试 mock |
| **WorktreeInitializer** | 环境初始化：复制配置、hooks、软链依赖 |
| **WorktreeCreator** | 调用 `git worktree add -B` 创建目录，编排初始化流程，幂等检测 |
| **WorktreeManager** | 核心编排器：对 Creator/Cleaner 的封装，提供 create/enter/exit/delete 统一接口 |
| **WorktreeCleaner** | 后台过期清理：三层过滤 + 安全删除 |
| **Agent 集成点** | 修改 `AgentRoleFrontmatter`、`SubAgentRunner`、`AgentTool` |

数据流：

```
AgentTool.execute()
  ├─ isolation: worktree?
  │    ├─ WorktreePath.validate(name)     // F1 校验
  │    ├─ WorktreeManager.create(name)    // F2 创建 + F3 初始化
  │    ├─ 注入通知文本到 prompt            // F6 上下文通知
  │    └─ 注入 worktree 路径到 cwd         // F4 进入
  ├─ SubAgentRunner.run()
  │    └─ AgentLoop.run(cwd=worktree路径)  // 全工具链继承
  └─ 完成后
       ├─ 有变更 → 保留 worktree + 提示
       └─ 无变更 → 自动删除
```

## 核心数据结构

### WorktreePath（值对象）

```typescript
class WorktreePath {
  readonly name: string;          // 原始输入，如 "sub/agent-x"
  readonly flatSlug: string;      // name 中 / → +，如 "sub+agent-x"
  readonly branchName: string;    // "worktree-" + flatSlug
  readonly fsPath: string;        // 完整文件系统路径

  static validate(input: string): WorktreePath;  // 校验并构造，失败抛 ValidationError
}
```

### WorktreeConfig

```typescript
interface WorktreeConfig {
  repoRoot: string;           // git 仓库根路径
  baseBranch: string;         // worktree 基于的分支
  worktreesDir: string;       // 默认 "<repoRoot>/.codia/worktrees"
  copyPatterns: string[];     // 需复制的配置 glob，如 [".claude/**", "CLAUDE.md"]
  symlinkDirs: string[];      // 需软链的目录，如 ["node_modules"]
}
```

### WorktreeInfo（元数据快照）

```typescript
interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  headCommit: string;           // 创建时的 HEAD commit sha
  createdAt: Date;
  lastActivityAt: Date;
  isClean: boolean;             // 无未提交修改
  commitCountAhead: number;     // 本地比 headCommit 多的 commit 数
}
```

### GitWorktreeOps（接口抽象）

```typescript
interface GitWorktreeOps {
  addWorktree(path: string, branch: string, baseBranch: string): Promise<void>;
  removeWorktree(path: string, force: boolean): Promise<void>;
  deleteBranch(branch: string): Promise<void>;
  getBranchName(path: string): Promise<string>;
  getHeadCommit(path: string): Promise<string>;
  hasUncommittedChanges(path: string): Promise<boolean>;
  getCommitCountAhead(path: string, baseCommit: string): Promise<number>;
  listWorktrees(): Promise<string[]>;           // 返回所有 worktree 路径
  getLastModified(path: string): Promise<Date>;
  getHooksPath(repoRoot: string): Promise<string | null>;  // git config core.hooksPath
}
```

### CleanupConfig

```typescript
interface CleanupConfig {
  cutoffDate: Date;
  autoPatterns: string[];         // 如 ["agent-a*", "wf_*"]
}
```

## 模块设计

### 模块 A: WorktreePath（值对象 + 校验器）

**职责：** F1 目录名校验的全部逻辑封装。

**对外接口：**
```typescript
class WorktreePath {
  static validate(input: string): WorktreePath;  // 唯一构造入口
  static isValid(input: string): boolean;         // 不抛异常的判断版
}

class ValidationError extends Error {
  code: "invalid_chars" | "too_long" | "path_traversal" | "absolute_path" | "empty_segment";
  field: string;
}
```

**校验规则（按顺序）：**
1. 空/纯空白 → `empty_segment`
2. 长度 > 64 字符 → `too_long`
3. 字符集 `[a-zA-Z0-9._/-]` 外 → `invalid_chars`
4. 以 `/` 开头或以 `/` 结尾 → `absolute_path`
5. 包含 `//` → `empty_segment`
6. 按 `/` 分段，存在 `.` 或 `..` 的独立段 → `path_traversal`

**依赖：** 无外部依赖。

---

### 模块 B: GitWorktreeOps（接口 + 真实实现）

**职责：** 封装所有 git 命令调用，提供可 mock 的抽象层。

**对外接口：**
```typescript
class RealGitWorktreeOps implements GitWorktreeOps {
  constructor(repoRoot: string);
  // 实现 GitWorktreeOps 的全部方法
  // 所有方法内部通过 execFile("git", [...args], { cwd: this.repoRoot }) 执行
}
```

**依赖：** Node.js `child_process` 模块。

---

### 模块 C: WorktreeInitializer

**职责：** F3 环境初始化全部逻辑。

**对外接口：**
```typescript
class WorktreeInitializer {
  constructor(config: WorktreeConfig, ops: GitWorktreeOps);
  async initialize(targetPath: string, repoRoot: string): Promise<void>;
}
```

**初始化步骤：**
1. 遍历 `copyPatterns`，用 glob 匹配主目录文件，复制到 targetPath
2. 检查 hooks：`ops.getHooksPath(repoRoot)` → 存在则复制其指向目录内容；不存在则复制 `<gitdir>/hooks/`（gitdir 通过 `git rev-parse --git-dir` 获取）
3. 遍历 `symlinkDirs`，对每个目录在 targetPath 下创建软链接指向主目录对应目录（优先 symlink，失败则 fallback copy）
4. 按显式规则列表补上 `.gitignore` 忽略但需要的文件

**依赖：** `GitWorktreeOps`、`WorktreeConfig`。

---

### 模块 D: WorktreeCreator

**职责：** F2 创建流程编排，包含幂等检测。

**对外接口：**
```typescript
class WorktreeCreator {
  constructor(config: WorktreeConfig, ops: GitWorktreeOps, initializer: WorktreeInitializer);
  async create(wp: WorktreePath): Promise<WorktreeInfo>;
}
```

#### 创建流程：
1. 确保 `worktreesDir`（默认 `.codia/worktrees/`）存在（`mkdir -p`）
2. 计算目标路径 → 若已存在目录且 `git worktree list` 中已记录 → 读取 fs 确认可访问 → 返回已有 WorktreeInfo（幂等）
3. `ops.addWorktree(path, wp.branchName, config.baseBranch)` → 使用 `-B` 标记
4. 记录 `headCommit`
5. 调用 `initializer.initialize(path, config.repoRoot)`
6. 返回 `WorktreeInfo`

**错误回滚：** 步骤 3 成功后，任一步骤失败则 `ops.removeWorktree(path, true)` 清理半成品。若 `removeWorktree` 本身也失败，记录严重错误日志（含 path），并尝试 `git worktree prune` 清理元数据，最终提示用户手动处理残留目录。

**依赖：** `GitWorktreeOps`、`WorktreeInitializer`、`WorktreeConfig`。

---

### 模块 E: WorktreeCleaner

**职责：** F7 过期清理逻辑。

**对外接口：**
```typescript
class WorktreeCleaner {
  constructor(config: WorktreeConfig, ops: GitWorktreeOps);
  async cleanup(cfg: CleanupConfig): Promise<CleanupResult>;
}
```

**CleanupResult：**
```typescript
interface CleanupResult {
  cleaned: string[];      // 已清理的目录名
  skipped: { name: string; reason: string }[];  // 跳过的及原因
}
```

**三层过滤顺序：**
1. 从 worktrees 目录下列出所有子目录 → 按命名模式过滤，仅匹配 `autoPatterns` 的进入下一步
2. 检查 `lastModified < cutoffDate`，过期则进入下一步
3. `ops.hasUncommittedChanges(path)` + `ops.getCommitCountAhead` → 有变更则加入 skipped

**依赖：** `GitWorktreeOps`、`WorktreeConfig`。

---

### 模块 F: WorktreeManager（编排器）

**职责：** F4/F5 的核心编排，对上层暴露统一接口。

**对外接口：**
```typescript
class WorktreeManager {
  constructor(config: WorktreeConfig, ops: GitWorktreeOps);
  async enter(name: string): Promise<{ cwd: string; info: WorktreeInfo }>;   // 创建 + 进入
  async exit(name: string, options?: { force?: boolean; keep?: boolean }): Promise<ExitResult>;
  async delete(name: string, force?: boolean): Promise<void>;
  async info(name: string): Promise<WorktreeInfo>;
  async list(): Promise<WorktreeInfo[]>;
}
```

**ExitResult：**
```typescript
interface ExitResult {
  action: "kept" | "removed";
  path: string;
  info: WorktreeInfo;
  warning?: string;  // 如果有变更被保护，说明原因
}
```

**exit 逻辑：**
1. 查询 worktree 是否存在 → 不存在则抛出 `WorktreeNotFoundError`，不执行任何文件系统操作
2. 获取 `WorktreeInfo`
3. 若 `keep=true`：仅标记，不改文件系统
4. 检查变更：`!isClean || commitCountAhead > 0` → 若无 `force` → 拒绝，返回 warning
5. `ops.removeWorktree(path, force)` → `ops.deleteBranch(branch)`

**依赖：** `WorktreeCreator`、`WorktreeCleaner`、`GitWorktreeOps`。

## 模块交互

### 创建 + 进入流程

```
AgentTool.execute()
  │
  ├─ role.frontmatter.isolation === "worktree"?
  │    │ YES
  │    ├─ 1. WorktreePath.validate(inputName)
  │    ├─ 2. WorktreeManager.enter(validatedName)
  │    │      ├─ WorktreeCreator.create(wp)
  │    │      │    ├─ GitWorktreeOps.addWorktree(path, branch, base)  // git worktree add -B
  │    │      │    └─ WorktreeInitializer.initialize(path)
  │    │      │         ├─ copyPatterns → 复制配置文件
  │    │      │         ├─ GitWorktreeOps.getHooksPath() → 复制 hooks
  │    │      │         └─ symlinkDirs → 软链依赖
  │    │      └─ 返回 { cwd, info }
  │    ├─ 3. 拼接通知文本 → 注入到 prompt 前
  │    └─ 4. SubAgentConfig.cwd = worktreeCwd
  │
  └─ SubAgentRunner.run() → AgentLoop.run(cwd)
```

### 退出 / 完成流程

```
SubAgentRunner.run() 结束
  │
  ├─ 获取 WorktreeInfo（变更检查）
  ├─ 有变更？
  │    ├─ YES → WorktreeManager.exit(name, { keep: true })
  │    │         → 保留 worktree，日志记录
  │    └─ NO  → WorktreeManager.exit(name)
  │              → WorktreeCreator 的逆操作
  │              → GitWorktreeOps.removeWorktree(path)
  │              → GitWorktreeOps.deleteBranch(branch)
```

### 后台清理

```
定时器 / 手动触发
  │
  └─ WorktreeCleaner.cleanup({ cutoffDate })
       ├─ 列出 .codia/worktrees/ 下所有子目录
       ├─ ① 命名模式过滤 (autoPatterns)
       ├─ ② 过期检查 (lastModified < cutoffDate)
       └─ ③ 变更保护 (hasUncommittedChanges / commitCountAhead)
            ├─ 跳过有变更的（记录日志）
            └─ GitWorktreeOps.removeWorktree + deleteBranch
```

## 文件组织

```
src/worktree/
├── types.ts              — WorktreeConfig, WorktreeInfo, CleanupConfig, CleanupResult,
│                           ExitResult, ValidationError, GitWorktreeOps(接口)
├── path-validator.ts     — WorktreePath 类 + validate/isValid
├── git-ops.ts            — RealGitWorktreeOps 实现
├── initializer.ts        — WorktreeInitializer 类
├── creator.ts            — WorktreeCreator 类
├── cleaner.ts            — WorktreeCleaner 类
├── manager.ts            — WorktreeManager 编排器
└── index.ts              — 统一导出

src/agent/role/types.ts   — [修改] AgentRoleFrontmatter 加 isolation 字段
src/agent/role/loader.ts  — [修改] 解析 isolation 字段
src/agent/sub-agent-runner.ts — [修改] 引入 worktree 创建/通知注入
src/agent/agent-tool.ts   — [修改] execute() 解析 isolation 参数

src/__tests__/worktree/
├── path-validator.test.ts
├── git-ops.test.ts
├── initializer.test.ts
├── creator.test.ts
├── cleaner.test.ts
└── manager.test.ts
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 分支名用 `-B` | 始终 `-B`，不用 `-b` | 防止上次未清理的孤儿分支导致创建失败；`-B` 自动重置覆盖 |
| WorktreePath 用 class | 值对象通过静态工厂构造 | 校验不可旁路；`validate()` 是唯一构造入口，确保路径永远有效 |
| Git 调用用接口封装 | `GitWorktreeOps` 接口 | 测试可完全 mock git，不碰真实仓库；满足 N5 可测试性 |
| cwd 显式传递 | 不改 `process.cwd()`，各组件传 `cwd` 参数 | 现有架构已用此模式（loop.ts 的 `cwd` 参数），不改动调用链 |
| 通知文本注入位置 | 在 `SubAgentRunner` 中拼接到 prompt 前面 | `SubAgentConfig.prompt` 是子 Agent 的消息起点，在此注入不破坏调用方 |
| 依赖软链用 `symlink` | 优先 `fs.symlink()`，失败回退 `cp -r` | 跨文件系统时 symlink 可能失败（如 Docker volume），保留回退 |
| 过期清理触发方式 | 提供 `cleanup()` 方法由上层定时调用 | 不在库内启动定时器，保持可控，上层配 Cron 或 scheduler 按需调 |
| .codia/ 目录的 .gitignore | 在 `WorktreeCreator.create()` 中自动检查并添加 | 第一步实现时不依赖外部配置，确保 worktrees 不被追踪 |
| 路径翻译策略 | LLM 自主翻译，通知文本中告知源路径和目标路径 | 子 Agent 是 LLM，可以通过通知文本理解路径对应关系自主翻译，无需额外的代码转换模块。如果后续发现 LLM 翻译不可靠，再补路径映射表 |
