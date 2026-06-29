# Agent isolation 参数化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `Agent` 工具的 `isolation` 参数真正生效，调用时可通过布尔参数指定是否启用 worktree 隔离。

**Architecture:** 在 `AgentTool.execute()` 中完成 `params.isolation ?? (role.frontmatter.isolation === "worktree") ?? false` 的优先级 resolve，将布尔值写入 `SubAgentConfig.isolation`。`SubAgentRunner` 不再访问角色 frontmatter，只看 `config.isolation`。

**Tech Stack:** TypeScript, vitest, Node.js 内置模块 (fs, crypto, child_process)

## Global Constraints

- 工具调用参数 > 角色配置 > 不做隔离
- `isolation` 统一为 `boolean` 类型
- Fork 模式默认不隔离，可显式开启
- 不改动 `AgentRoleFrontmatter` 接口

---

### Task 1: SubAgentConfig 新增 isolation 字段

**Files:**
- Modify: `src/agent/types.ts:67-82`

**Interfaces:**
- Produces: `SubAgentConfig.isolation: boolean` (后续 Task 2、3、4 依赖)

- [ ] **Step 1: 在 SubAgentConfig 接口中新增 isolation 字段**

在 `runInBackground` 字段上方插入 `isolation`：

```typescript
// SubAgentConfig —— 子 Agent 运行器的输入配置
export interface SubAgentConfig {
  type: "definition" | "fork";
  role?: AgentRole; // 定义式必填
  prompt: string; // 任务描述
  description: string; // 简短描述，用于进度展示
  name?: string; // 显示名称
  model?: string; // 模型覆盖
  isolation: boolean; // 是否启用 worktree 文件系统隔离
  runInBackground: boolean; // 是否后台运行（Fork 强制 true）
  parentMessages: Message[]; // 父对话消息（Fork 式继承用）
  parentProvider: LLMProvider;
  parentChatConfig: ChatConfig;
  parentRegistry: ToolRegistry;
  parentHookEngine?: HookEngine;
  cwd: string; // 工作目录
  signal: AbortSignal; // 取消信号
}
```

- [ ] **Step 2: 验证编译报错**

Run: `npx tsc --noEmit 2>&1 | grep "isolation" | head -20`
Expected: 多处编译错误，提示 `isolation` 字段缺失（agent-tool.ts 和测试文件中构造 SubAgentConfig 的地方）

- [ ] **Step 3: Commit**

```bash
git add src/agent/types.ts
git commit -m "feat(agent): SubAgentConfig 新增 isolation 字段

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: AgentTool 读取 isolation 参数并 resolve 优先级

**Files:**
- Modify: `src/agent/agent-tool.ts` (完整文件)

**Interfaces:**
- Consumes: `SubAgentConfig.isolation: boolean` (来自 Task 1)
- Produces: Agent 工具 isolation 参数从 "预留" 变为可用

- [ ] **Step 1: 重写 execute() — 一次性替换从 inputSchema 到 runAgent 的全部内容**

用以下完整代码替换 `src/agent/agent-tool.ts` 第 19-190 行（从 `inputSchema` 到文件末尾）：

```typescript
  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      subagent_type: {
        type: "string",
        description:
          '角色名（如 "Explore"、"Plan"、"code-reviewer"），留空则为 Fork 式继承父对话',
      },
      description: {
        type: "string",
        description: "简短描述（3-5 词），用于进度展示",
      },
      prompt: {
        type: "string",
        description: "委派给子 Agent 的任务描述",
      },
      name: {
        type: "string",
        description: "可选的显示名称",
      },
      model: {
        type: "string",
        description: "可选模型覆盖",
      },
      run_in_background: {
        type: "boolean",
        description: "是否显式后台运行",
      },
      isolation: {
        type: "boolean",
        description:
          "是否启用 git worktree 文件系统隔离。默认遵循角色配置，显式传入则覆盖角色默认值",
      },
    },
    required: ["description", "prompt"],
  };

  private registry: AgentRoleRegistry;
  private taskManager: TaskManager;
  private chatConfig: ChatConfig;
  private provider: LLMProvider;
  private hookEngine?: HookEngine;
  private getParentMessages: () => Message[];
  private getParentRegistry: () => ToolRegistry;

  constructor(
    registry: AgentRoleRegistry,
    taskManager: TaskManager,
    chatConfig: ChatConfig,
    provider: LLMProvider,
    getParentMessages: () => Message[],
    getParentRegistry: () => ToolRegistry,
    hookEngine?: HookEngine,
  ) {
    this.registry = registry;
    this.taskManager = taskManager;
    this.chatConfig = chatConfig;
    this.provider = provider;
    this.getParentMessages = getParentMessages;
    this.getParentRegistry = getParentRegistry;
    this.hookEngine = hookEngine;
  }

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const description = params.description as string;
    const prompt = params.prompt as string;

    if (!description || !prompt) {
      return {
        status: "error",
        content: "缺少必填参数 description 和/或 prompt",
      };
    }

    const subagentType = params.subagent_type as string | undefined;
    const displayName = params.name as string | undefined;
    const model = params.model as string | undefined;
    const runInBackground = params.run_in_background === true;

    // isolation 优先级：工具调用参数 > 角色 frontmatter > false
    const role = subagentType ? this.registry.resolve(subagentType) : undefined;
    if (subagentType && !role) {
      return {
        status: "error",
        content: `角色 "${subagentType}" 不存在。可用角色：${this.registry
          .list()
          .map((r) => r.frontmatter.name)
          .join(", ")}`,
      };
    }
    const isolation =
      typeof params.isolation === "boolean"
        ? params.isolation
        : role?.frontmatter.isolation === "worktree";

    // 解析类型：有 subagent_type → 定义式，留空 → Fork 式
    if (subagentType) {
      // 定义式
      const subAgentConfig: SubAgentConfig = {
        type: "definition",
        role: role!,
        prompt,
        description,
        name: displayName ?? role!.frontmatter.name,
        model,
        isolation,
        runInBackground: false, // 定义式默认前台，除非显式指定
        parentMessages: [],
        parentProvider: this.provider,
        parentChatConfig: this.chatConfig,
        parentRegistry: this.getParentRegistry(),
        parentHookEngine: this.hookEngine,
        cwd: context.cwd,
        signal: context.signal,
      };

      return this.runAgent(subAgentConfig, runInBackground);
    }

    // Fork 式
    const subAgentConfig: SubAgentConfig = {
      type: "fork",
      prompt,
      description,
      name: displayName ?? "fork",
      model,
      isolation,
      runInBackground: true, // Fork 强制后台
      parentMessages: this.getParentMessages(),
      parentProvider: this.provider,
      parentChatConfig: this.chatConfig,
      parentRegistry: this.getParentRegistry(),
      parentHookEngine: this.hookEngine,
      cwd: context.cwd,
      signal: context.signal,
    };

    return this.runAgent(subAgentConfig, true); // Fork 强制后台
  }

  private async runAgent(
    config: SubAgentConfig,
    runInBackground: boolean,
  ): Promise<ToolResult> {
    const runner = new SubAgentRunner(config);

    if (runInBackground) {
      // 后台执行
      const taskId = this.taskManager.create(config.description, config.type);
      runner.runInBackground(this.taskManager, taskId);

      return {
        status: "success",
        content: `子 Agent 已加入后台执行队列，任务 ID: ${taskId}。可通过 TaskList 查询状态。`,
      };
    }

    // 前台执行
    try {
      const result = await runner.run();

      if (result.status === "failed" || result.status === "cancelled") {
        return {
          status: "error",
          content: result.text || `子 Agent 执行失败（${result.status}）`,
        };
      }

      return {
        status: "success",
        content: result.text,
      };
    } catch (e) {
      return {
        status: "error",
        content: `子 Agent 执行异常：${(e as Error).message}`,
      };
    }
  }
}
```

关键变化 vs 旧代码：
1. `inputSchema` 中 `isolation` 从 `type: "string"` 改为 `type: "boolean"`
2. `role` resolve 和不存在检查上提到 `subagentType` 之后立即执行
3. `isolation` resolve 逻辑：`typeof params.isolation === "boolean" ? params.isolation : role?.frontmatter.isolation === "worktree"`
4. 两处 `SubAgentConfig` 构造都加入 `isolation` 字段

- [ ] **Step 2: Commit**

```bash
git add src/agent/agent-tool.ts
git commit -m "feat(agent): AgentTool isolation 参数改为 boolean 并实现优先级 resolve

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: SubAgentRunner 使用 config.isolation

**Files:**
- Modify: `src/agent/sub-agent-runner.ts:33-35` (worktree 检查条件)

**Interfaces:**
- Consumes: `SubAgentConfig.isolation: boolean` (来自 Task 1)

- [ ] **Step 1: 替换 worktree 隔离条件**

将：

```typescript
    // 0. 检查是否需要 worktree 隔离
      if (config.role?.frontmatter.isolation === "worktree") {
```

替换为：

```typescript
    // 0. 检查是否需要 worktree 隔离（由 AgentTool 层 resolve，Runner 只看 config.isolation）
    if (config.isolation) {
```

注意：旧代码第 34 行有额外缩进（4 空格），替换时统一为 2 空格缩进。

- [ ] **Step 2: 验证无残留引用**

Run: `grep -n "role.*isolation" src/agent/sub-agent-runner.ts`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add src/agent/sub-agent-runner.ts
git commit -m "feat(agent): SubAgentRunner 改用 config.isolation 判断隔离

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 更新测试

**Files:**
- Modify: `src/__tests__/agent/sub-agent-runner.test.ts` (补 isolation 字段 + 更新 worktree 测试)
- Modify: `src/__tests__/agent/agent-tool.test.ts` (更新 inputSchema 类型断言)

**Interfaces:**
- Consumes: `SubAgentConfig.isolation: boolean` (来自 Task 1)

- [ ] **Step 1: sub-agent-runner.test.ts — 三处普通构造补 isolation: false**

构造 `SubAgentConfig` 的 3 个非隔离测试分别加上 `isolation: false`：

```typescript
// 第 42 行附近 "定义式：runInBackground 由 config 决定"
      isolation: false,
      runInBackground: false,

// 第 66 行附近 "Fork 式：runInBackground 强制 true"
      isolation: false,
      runInBackground: true,

// 第 88 行附近 "runInBackground 方法不抛异常"
      isolation: false,
      runInBackground: true,
```

- [ ] **Step 2: sub-agent-runner.test.ts — worktree 隔离测试补 isolation: true**

两处 worktree 隔离测试的 config 加上 `isolation: true`：

```typescript
// "isolation: worktree 角色自动创建隔离目录并注入通知文本"
      isolation: true,
      runInBackground: false,

// "isolation: worktree 子 Agent prompt 包含上下文通知文本"
      isolation: true,
      runInBackground: false,
```

- [ ] **Step 3: sub-agent-runner.test.ts — "未声明 isolation 的角色" 测试补 isolation: false**

```typescript
// "未声明 isolation 的角色行为不变"
      isolation: false,
      runInBackground: false,
```

- [ ] **Step 4: agent-tool.test.ts — "inputSchema 包含所有参数" 测试中加类型断言**

将现有的：

```typescript
    expect(properties.isolation).toBeDefined();
```

更新为：

```typescript
    expect(properties.isolation).toBeDefined();
    expect(properties.isolation.type).toBe("boolean");
```

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/agent/sub-agent-runner.test.ts src/__tests__/agent/agent-tool.test.ts
git commit -m "test(agent): 更新测试以适配 config.isolation 和 boolean 类型 isolation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 运行测试并验证

- [ ] **Step 1: 运行全量测试**

Run: `pnpm test`
Expected: 所有测试 PASS

- [ ] **Step 2: 仅运行 Agent 相关测试**

Run: `pnpm test -- --reporter=verbose src/__tests__/agent/ 2>&1`
Expected: 所有 agent 测试 PASS

- [ ] **Step 3: Commit (如有修复)**

```bash
git add -A
git commit -m "fix(agent): 修复 isolation 参数化后测试失败

Co-Authored-By: Claude <noreply@anthropic.com>"
```
