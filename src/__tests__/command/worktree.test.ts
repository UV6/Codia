import { describe, it, expect, vi } from "vitest";
import { handleWorktree, worktreeCommand } from "../../command/builtin/worktree.js";
import type { UIContext } from "../../command/types.js";

function makeUIContext(overrides: Partial<UIContext> = {}): UIContext {
  return {
    showMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    createTeam: vi.fn(),
    listTeams: vi.fn(),
    migrateLegacyWorktrees: vi.fn(async () => ({ moved: [], skipped: [] })),
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

describe("handleWorktree", () => {
  it("migrate 成功时显示结果", async () => {
    const ui = makeUIContext({
      migrateLegacyWorktrees: vi.fn(async () => ({
        moved: [{ from: "/old/a", to: "/new/a" }],
        skipped: [],
      })),
    });

    await handleWorktree("migrate", ui);

    expect(ui.showMessage).toHaveBeenCalledWith(
      "已迁移 1 个 worktree:\n- /old/a -> /new/a",
      "info",
    );
  });

  it("没有旧 worktree 时提示无迁移项", async () => {
    const ui = makeUIContext();

    await handleWorktree("migrate", ui);

    expect(ui.showMessage).toHaveBeenCalledWith("没有检测到需要迁移的旧 worktree。", "info");
  });
});

describe("worktreeCommand", () => {
  it("type 为 local 且有 handler", () => {
    expect(worktreeCommand.type).toBe("local");
    expect(worktreeCommand.handler).toBeDefined();
  });
});
