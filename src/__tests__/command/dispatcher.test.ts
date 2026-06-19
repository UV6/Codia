import { describe, it, expect, vi } from "vitest";
import { dispatch } from "../../command/dispatcher.js";
import type { CommandDef, UIContext } from "../../command/types.js";

function makeMockUI(): UIContext {
  return {
    showMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    clearMessages: vi.fn(),
    setMode: vi.fn(),
    getMode: vi.fn(() => "full"),
    getTokenUsage: vi.fn(() => ({ inputTokens: 100, outputTokens: 50, model: "test" })),
    triggerCompact: vi.fn(),
    refreshStatus: vi.fn(),
  } as UIContext;
}

describe("dispatch", () => {
  it("local 型命令直接执行 handler，不调 sendUserMessage", () => {
    const ui = makeMockUI();
    const handler = vi.fn();
    const cmd: CommandDef = {
      name: "test",
      description: "test",
      type: "local",
      handler,
    };

    dispatch(cmd, "", ui);

    expect(handler).toHaveBeenCalledWith("", ui);
    expect(ui.sendUserMessage).not.toHaveBeenCalled();
  });

  it("ui 型命令直接执行 handler，不调 sendUserMessage", () => {
    const ui = makeMockUI();
    const handler = vi.fn();
    const cmd: CommandDef = {
      name: "clear",
      description: "clear",
      type: "ui",
      handler,
    };

    dispatch(cmd, "", ui);

    expect(handler).toHaveBeenCalledWith("", ui);
    expect(ui.sendUserMessage).not.toHaveBeenCalled();
  });

  it("prompt 型命令调 sendUserMessage，不调 handler", () => {
    const ui = makeMockUI();
    const handler = vi.fn();
    const cmd: CommandDef = {
      name: "review",
      description: "review",
      type: "prompt",
      promptText: "请审查代码",
      handler,
    };

    dispatch(cmd, "", ui);

    expect(handler).not.toHaveBeenCalled();
    expect(ui.sendUserMessage).toHaveBeenCalledWith("请审查代码");
  });

  it("prompt 型命令带 args 时，注入文本包含 promptText 和参数", () => {
    const ui = makeMockUI();
    const cmd: CommandDef = {
      name: "review",
      description: "review",
      type: "prompt",
      promptText: "请审查代码",
      handler: () => {},
    };

    dispatch(cmd, "src/foo.ts", ui);

    expect(ui.sendUserMessage).toHaveBeenCalledWith(
      "请审查代码\n\n参数: src/foo.ts",
    );
  });

  it("prompt 型无 promptText 但有 args 时，仅注入 args", () => {
    const ui = makeMockUI();
    const cmd: CommandDef = {
      name: "xyz",
      description: "xyz",
      type: "prompt",
      handler: () => {},
    };

    dispatch(cmd, "hello", ui);

    expect(ui.sendUserMessage).toHaveBeenCalledWith("hello");
  });
});
