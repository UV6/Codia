import { describe, it, expect, vi } from "vitest";
import {
  skillsCommand,
  setCommandProvider,
} from "../../command/builtin/skills.js";
import type { CommandDef, UIContext } from "../../command/types.js";

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
    getContextInfo: () => ({
      estimatedTokens: 0,
      messageCount: 0,
      maxTokens: 200_000,
    }),
    getCwd: () => "/mock/project",
    ...overrides,
  };
}

describe("skillsCommand", () => {
  it("未注入 provider 时显示没有可用 Skill", () => {
    const ui = makeUIContext();
    skillsCommand.handler("", ui);
    expect(ui.showMessage).toHaveBeenCalledWith(
      "当前没有可用的 Skill。",
      "info",
    );
  });

  it("仅显示 prompt 类型的命令", () => {
    const ui = makeUIContext();
    const commands: CommandDef[] = [
      {
        name: "commit",
        description: "提交代码",
        type: "prompt",
        promptText: "请提交代码",
        handler: () => {},
      },
      {
        name: "help",
        description: "帮助",
        type: "local",
        handler: () => {},
      },
      {
        name: "review",
        description: "审查代码",
        type: "prompt",
        promptText: "请审查代码",
        handler: () => {},
      },
    ];
    setCommandProvider(() => commands);

    skillsCommand.handler("", ui);

    expect(ui.showMessage).toHaveBeenCalledWith(
      expect.stringContaining("/commit"),
      "info",
    );
    expect(ui.showMessage).toHaveBeenCalledWith(
      expect.stringContaining("/review"),
      "info",
    );
    expect(ui.showMessage).not.toHaveBeenCalledWith(
      expect.stringContaining("/help"),
      "info",
    );
  });

  it("展示 skill 的别名", () => {
    const ui = makeUIContext();
    const commands: CommandDef[] = [
      {
        name: "review",
        aliases: ["r"],
        description: "审查代码",
        type: "prompt",
        promptText: "请审查代码",
        handler: () => {},
      },
    ];
    setCommandProvider(() => commands);

    skillsCommand.handler("", ui);

    expect(ui.showMessage).toHaveBeenCalledWith(
      expect.stringContaining("(r)"),
      "info",
    );
  });
});
