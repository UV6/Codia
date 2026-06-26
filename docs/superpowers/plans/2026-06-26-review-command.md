# /review 命令改进实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/review` 自动读取工作区未暂存 git diff 并拼入审查 prompt 发送给 LLM，支持一个可选位置参数作为额外关注点。

**Architecture:** 把 `/review` 从 `prompt` 型改为 `local` 型命令；扩展 `UIContext` 提供当前工作目录；handler 内部异步执行 `git diff`，构造完整 prompt 后调用 `ui.sendUserMessage`。

**Tech Stack:** TypeScript, vitest, Node.js `child_process.execFile`

## Global Constraints

- 默认读取工作区未暂存变更（`git diff`）。
- 只支持一个可选位置参数作为额外关注点。
- 不引入专门 sub-agent，复用当前对话的 LLM。
- Prompt 维度固定为 4 个：逻辑错误、安全问题、性能问题、代码风格。
- 单元测试必须覆盖：有 diff、无 diff、有额外关注点、git 失败。

---

## File Structure

- `src/command/types.ts`：扩展 `UIContext` 接口，新增 `getCwd(): string`。
- `src/tui/app.tsx`：在 `uiContext` 中实现 `getCwd: () => process.cwd()`。
- `src/__tests__/command/context.test.ts`：在 `makeUIContext` 中补充 `getCwd` mock。
- `src/command/builtin/review.ts`：重写为 `local` 型命令，新增 `getWorkingDiff` 和 `handleReview`。
- `src/__tests__/command/review.test.ts`：新增 `/review` 命令单元测试。

---

### Task 1: 扩展 UIContext 并提供 getCwd 实现

**Files:**
- Modify: `src/command/types.ts:18`
- Modify: `src/tui/app.tsx:182-234`
- Modify: `src/__tests__/command/context.test.ts:5-19`

**Interfaces:**
- Consumes: 无
- Produces: `UIContext.getCwd(): string`

- [ ] **Step 1: 在 UIContext 接口中添加 getCwd 方法**

在 `src/command/types.ts` 的 `UIContext` 接口中新增一行：

```ts
export interface UIContext {
  showMessage(text: string, type: "info" | "warning" | "error"): void;
  sendUserMessage(text: string): void;
  clearMessages(): void;
  setMode(mode: "full" | "plan"): void;
  getMode(): "full" | "plan";
  setPermissionMode(mode: import("../permission/types.js").PermissionMode): void;
  getTokenUsage(): { inputTokens: number; outputTokens: number; model: string } | null;
  triggerCompact(): void;
  refreshStatus(): void;
  getContextInfo(): { estimatedTokens: number; messageCount: number; maxTokens: number };
  getCwd(): string; // 新增
}
```

- [ ] **Step 2: 在 App 的 uiContext 中实现 getCwd**

在 `src/tui/app.tsx` 的 `uiContext` 对象中添加：

```ts
const uiContext: UIContext = useMemo(() => ({
  // ... 现有方法
  getCwd() {
    return process.cwd();
  },
}), [service, handleAISubmit, mode, usage]);
```

- [ ] **Step 3: 在测试辅助函数中补充 mock**

在 `src/__tests__/command/context.test.ts` 的 `makeUIContext` 返回值中添加：

```ts
function makeUIContext(overrides: Partial<UIContext> = {}): UIContext {
  return {
    showMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    clearMessages: vi.fn(),
    setMode: vi.fn(),
    getMode: () => "full",
    setPermissionMode: vi.fn(),
    getTokenUsage: () => null,
    triggerCompact: vi.fn(),
    refreshStatus: vi.fn(),
    getContextInfo: () => ({ estimatedTokens: 0, messageCount: 0, maxTokens: 200_000 }),
    getCwd: () => "/mock/project", // 新增
    ...overrides,
  };
}
```

- [ ] **Step 4: 运行现有命令相关测试**

```bash
pnpm test src/__tests__/command/context.test.ts src/__tests__/command/dispatcher.test.ts src/__tests__/command/registry.test.ts src/__tests__/command/parser.test.ts
```

Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add src/command/types.ts src/tui/app.tsx src/__tests__/command/context.test.ts
git commit -m "feat: UIContext 增加 getCwd 供命令获取当前工作目录

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 重写 /review 命令集成 git diff

**Files:**
- Modify: `src/command/builtin/review.ts`
- Create: `src/__tests__/command/review.test.ts`

**Interfaces:**
- Consumes: `UIContext.getCwd(): string`, `UIContext.showMessage()`, `UIContext.sendUserMessage()`
- Produces: `reviewCommand: CommandDef`, `getWorkingDiff(cwd: string): Promise<string>`, `handleReview(args: string, ui: UIContext): Promise<void>`

- [ ] **Step 1: 编写 /review 命令测试**

创建 `src/__tests__/command/review.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { reviewCommand, getWorkingDiff, handleReview } from "../../command/builtin/review.js";
import type { UIContext } from "../../command/types.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

import { execFile } from "node:child_process";

function makeUIContext(overrides: Partial<UIContext> = {}): UIContext {
  return {
    showMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    clearMessages: vi.fn(),
    setMode: vi.fn(),
    getMode: () => "full",
    setPermissionMode: vi.fn(),
    getTokenUsage: () => null,
    triggerCompact: vi.fn(),
    refreshStatus: vi.fn(),
    getContextInfo: () => ({ estimatedTokens: 0, messageCount: 0, maxTokens: 200_000 }),
    getCwd: () => "/mock/project",
    ...overrides,
  };
}

function mockExecFile(stdout: string, stderr = "", exitCode: number | null = 0) {
  vi.mocked(execFile).mockImplementationOnce((cmd, args, opts, callback) => {
    if (typeof callback === "function") {
      callback(exitCode === 0 || exitCode === null ? null : new Error(`exit ${exitCode}`) as any, stdout, stderr);
    }
    return undefined as any;
  });
}

describe("getWorkingDiff", () => {
  it("返回 git diff 输出", async () => {
    mockExecFile("diff --git a/foo.ts b/foo.ts\n+bar");
    const result = await getWorkingDiff("/mock/project");
    expect(result).toBe("diff --git a/foo.ts b/foo.ts\n+bar");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["diff"],
      expect.objectContaining({ cwd: "/mock/project", encoding: "utf-8" }),
      expect.any(Function),
    );
  });

  it("去除首尾空白", async () => {
    mockExecFile("\n\ndiff content\n\n");
    const result = await getWorkingDiff("/mock/project");
    expect(result).toBe("diff content");
  });

  it("git 失败时抛出错误", async () => {
    mockExecFile("", "fatal: not a git repository", 128);
    await expect(getWorkingDiff("/mock/project")).rejects.toThrow();
  });
});

describe("handleReview", () => {
  it("无未暂存变更时提示 warning", async () => {
    mockExecFile("");
    const ui = makeUIContext();
    await handleReview("", ui);
    expect(ui.showMessage).toHaveBeenCalledWith("当前没有未暂存的代码变更。", "warning");
    expect(ui.sendUserMessage).not.toHaveBeenCalled();
  });

  it("有 diff 时发送完整 prompt", async () => {
    mockExecFile("diff --git a/foo.ts b/foo.ts\n+bar");
    const ui = makeUIContext();
    await handleReview("", ui);
    expect(ui.sendUserMessage).toHaveBeenCalledOnce();
    const sent = vi.mocked(ui.sendUserMessage).mock.calls[0][0];
    expect(sent).toContain("请审查当前 git diff 中的代码变更");
    expect(sent).toContain("1. 逻辑错误");
    expect(sent).toContain("2. 安全问题");
    expect(sent).toContain("3. 性能问题");
    expect(sent).toContain("4. 代码风格");
    expect(sent).toContain("diff --git a/foo.ts b/foo.ts");
  });

  it("有额外关注点时追加到 prompt", async () => {
    mockExecFile("diff --git a/foo.ts b/foo.ts\n+bar");
    const ui = makeUIContext();
    await handleReview("特别注意并发安全", ui);
    const sent = vi.mocked(ui.sendUserMessage).mock.calls[0][0];
    expect(sent).toContain("额外关注：特别注意并发安全");
  });

  it("git 失败时提示 error", async () => {
    mockExecFile("", "fatal: not a git repository", 128);
    const ui = makeUIContext();
    await handleReview("", ui);
    expect(ui.showMessage).toHaveBeenCalledWith(expect.stringContaining("读取 git diff 失败"), "error");
    expect(ui.sendUserMessage).not.toHaveBeenCalled();
  });
});

describe("reviewCommand", () => {
  it("type 为 local 且有 handler", () => {
    expect(reviewCommand.type).toBe("local");
    expect(reviewCommand.handler).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test src/__tests__/command/review.test.ts
```

Expected: 失败，提示 `getWorkingDiff` 或 `handleReview` 未定义

- [ ] **Step 3: 实现 /review 命令**

完整替换 `src/command/builtin/review.ts` 为：

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommandDef, UIContext } from "../types.js";

const execFileAsync = promisify(execFile);

const REVIEW_PROMPT = `请审查当前 git diff 中的代码变更。重点关注：

1. 逻辑错误
2. 安全问题
3. 性能问题
4. 代码风格

请给出具体的审查结论和改进建议。`;

export async function getWorkingDiff(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["diff"], {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
  });
  return stdout.trim();
}

export async function handleReview(args: string, ui: UIContext): Promise<void> {
  try {
    const diff = await getWorkingDiff(ui.getCwd());
    if (!diff) {
      ui.showMessage("当前没有未暂存的代码变更。", "warning");
      return;
    }

    let prompt = `${REVIEW_PROMPT}\n\n${diff}`;
    if (args) {
      prompt += `\n\n额外关注：${args}`;
    }

    ui.sendUserMessage(prompt);
  } catch (err) {
    ui.showMessage(`读取 git diff 失败：${(err as Error).message}`, "error");
  }
}

export const reviewCommand: CommandDef = {
  name: "review",
  aliases: ["cr"],
  description: "触发代码审查",
  usage: "/review [额外关注点]",
  argsHint: "额外关注点",
  type: "local",
  handler: (args: string, ui: UIContext): void => {
    void handleReview(args, ui);
  },
};
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test src/__tests__/command/review.test.ts
```

Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add src/command/builtin/review.ts src/__tests__/command/review.test.ts
git commit -m "feat: /review 自动读取工作区 git diff 并拼入 prompt

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 全量测试与类型检查

**Files:**
- 无新增或修改

- [ ] **Step 1: 运行全部测试**

```bash
pnpm test
```

Expected: 全部通过

- [ ] **Step 2: 运行 TypeScript 类型检查**

```bash
pnpm typecheck
```

Expected: 无类型错误

- [ ] **Step 3: Commit（如类型检查有修复）**

如果 typecheck 发现需要修复，单独 commit：

```bash
git add -A
git commit -m "fix: 修复 /review 改动导致的类型问题

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- 自动读取工作区未暂存 git diff → Task 2
- 单参数作为额外关注点 → Task 2 测试与实现
- prompt 维度优化为 4 个 → Task 2 `REVIEW_PROMPT`
- 不引入 sub-agent → Task 2 仍调用 `ui.sendUserMessage`
- 边界处理（无 diff、git 失败） → Task 2 测试与实现

**2. Placeholder scan:**
- 无 TBD/TODO
- 所有代码块完整
- 所有命令具体

**3. Type consistency:**
- `UIContext.getCwd()` 在 Task 1 定义，Task 2 使用 `ui.getCwd()`，一致
- `reviewCommand` 类型为 `CommandDef`，handler 签名匹配
