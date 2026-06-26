import { describe, it, expect, vi } from "vitest";
import { contextCommand } from "../../command/builtin/context.js";
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

describe("contextCommand", () => {
  it("零消息时显示 0/200K", () => {
    const ui = makeUIContext();
    contextCommand.handler("", ui);
    expect(ui.showMessage).toHaveBeenCalledWith(
      "上下文估算: 0 / 200.0K token (0.0%)\n消息数: 0 条",
      "info",
    );
  });

  it("百分比计算正确", () => {
    const ui = makeUIContext({
      getContextInfo: () => ({
        estimatedTokens: 50_000,
        messageCount: 10,
        maxTokens: 200_000,
      }),
    });
    contextCommand.handler("", ui);
    expect(ui.showMessage).toHaveBeenCalledWith(
      expect.stringContaining("50.0K / 200.0K token (25.0%)"),
      "info",
    );
  });

  it("小数值不转 K", () => {
    const ui = makeUIContext({
      getContextInfo: () => ({
        estimatedTokens: 500,
        messageCount: 3,
        maxTokens: 200_000,
      }),
    });
    contextCommand.handler("", ui);
    expect(ui.showMessage).toHaveBeenCalledWith(
      expect.stringContaining("500 / 200.0K token (0.3%)"),
      "info",
    );
  });

  it("消息数正确传递", () => {
    const ui = makeUIContext({
      getContextInfo: () => ({
        estimatedTokens: 1000,
        messageCount: 42,
        maxTokens: 200_000,
      }),
    });
    contextCommand.handler("", ui);
    expect(ui.showMessage).toHaveBeenCalledWith(
      expect.stringContaining("消息数: 42 条"),
      "info",
    );
  });
});
