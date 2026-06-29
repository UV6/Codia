import { describe, it, expect, vi } from "vitest";
import { handleTeam, teamCommand } from "../../command/builtin/team.js";
import type { UIContext } from "../../command/types.js";

function makeUIContext(overrides: Partial<UIContext> = {}): UIContext {
  return {
    showMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    createTeam: vi.fn(async (teamName: string, leadName: string) => ({ name: teamName, lead: leadName })),
    listTeams: vi.fn(async () => []),
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

describe("handleTeam", () => {
  it("create 成功时提示创建结果", async () => {
    const ui = makeUIContext();

    await handleTeam("create alpha alice", ui);

    expect(ui.createTeam).toHaveBeenCalledWith("alpha", "alice");
    expect(ui.showMessage).toHaveBeenCalledWith(
      'team "alpha" 已创建，Lead 为 "alice"。',
      "info",
    );
  });

  it("create 参数不足时显示用法", async () => {
    const ui = makeUIContext();

    await handleTeam("create alpha", ui);

    expect(ui.showMessage).toHaveBeenCalledWith(
      "用法: /team create <teamName> <leadName> 或 /team list",
      "warning",
    );
  });

  it("create 失败时显示错误", async () => {
    const ui = makeUIContext({
      createTeam: vi.fn(async () => {
        throw new Error("小组 \"alpha\" 已存在");
      }),
    });

    await handleTeam("create alpha alice", ui);

    expect(ui.showMessage).toHaveBeenCalledWith(
      "创建 team 失败：小组 \"alpha\" 已存在",
      "error",
    );
  });

  it("list 在空列表时提示无 team", async () => {
    const ui = makeUIContext({
      listTeams: vi.fn(async () => []),
    });

    await handleTeam("list", ui);

    expect(ui.showMessage).toHaveBeenCalledWith("当前还没有 team。", "info");
  });

  it("list 返回 team 列表", async () => {
    const ui = makeUIContext({
      listTeams: vi.fn(async () => ["alpha", "beta"]),
    });

    await handleTeam("list", ui);

    expect(ui.showMessage).toHaveBeenCalledWith(
      "当前 team:\n- alpha\n- beta",
      "info",
    );
  });
});

describe("teamCommand", () => {
  it("type 为 local 且有 handler", () => {
    expect(teamCommand.type).toBe("local");
    expect(teamCommand.handler).toBeDefined();
  });
});
