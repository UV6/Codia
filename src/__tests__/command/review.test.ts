import { describe, it, expect, vi } from "vitest";
import { reviewCommand, getWorkingDiff, handleReview } from "../../command/builtin/review.js";
import type { UIContext } from "../../command/types.js";

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

function mockRunner(stdout: string, stderr = "") {
  return vi.fn().mockResolvedValue({ stdout, stderr });
}

describe("getWorkingDiff", () => {
  it("返回 git diff 输出", async () => {
    const runner = mockRunner("diff --git a/foo.ts b/foo.ts\n+bar");
    const result = await getWorkingDiff("/mock/project", runner);
    expect(result).toBe("diff --git a/foo.ts b/foo.ts\n+bar");
    expect(runner).toHaveBeenCalledWith(
      "git",
      ["diff"],
      expect.objectContaining({ cwd: "/mock/project", encoding: "utf-8" }),
    );
  });

  it("去除首尾空白", async () => {
    const runner = mockRunner("\n\ndiff content\n\n");
    const result = await getWorkingDiff("/mock/project", runner);
    expect(result).toBe("diff content");
  });

  it("git 失败时抛出错误", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("fatal: not a git repository"));
    await expect(getWorkingDiff("/mock/project", runner)).rejects.toThrow("fatal: not a git repository");
  });
});

describe("handleReview", () => {
  it("无未暂存变更时提示 warning", async () => {
    const runner = mockRunner("");
    const ui = makeUIContext();
    await handleReview("", ui, runner);
    expect(ui.showMessage).toHaveBeenCalledWith("当前没有未暂存的代码变更。", "warning");
    expect(ui.sendUserMessage).not.toHaveBeenCalled();
  });

  it("有 diff 时发送完整 prompt", async () => {
    const runner = mockRunner("diff --git a/foo.ts b/foo.ts\n+bar");
    const ui = makeUIContext();
    await handleReview("", ui, runner);
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
    const runner = mockRunner("diff --git a/foo.ts b/foo.ts\n+bar");
    const ui = makeUIContext();
    await handleReview("特别注意并发安全", ui, runner);
    const sent = vi.mocked(ui.sendUserMessage).mock.calls[0][0];
    expect(sent).toContain("额外关注：特别注意并发安全");
  });

  it("git 失败时提示 error", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("fatal: not a git repository"));
    const ui = makeUIContext();
    await handleReview("", ui, runner);
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
