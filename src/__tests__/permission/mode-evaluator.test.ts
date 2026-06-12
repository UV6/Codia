import { describe, it, expect } from "vitest";
import { evaluate, toolTypeToCategory } from "../../permission/mode-evaluator.js";

describe("toolTypeToCategory", () => {
  it("shell 类型 → shell", () => {
    expect(toolTypeToCategory("shell", true)).toBe("shell");
    expect(toolTypeToCategory("shell", false)).toBe("shell");
  });

  it("file + destructive → edit", () => {
    expect(toolTypeToCategory("file", true)).toBe("edit");
  });

  it("file + !destructive → readonly", () => {
    expect(toolTypeToCategory("file", false)).toBe("readonly");
  });

  it("search + !destructive → readonly", () => {
    expect(toolTypeToCategory("search", false)).toBe("readonly");
  });
});

describe("evaluate (Layer 4)", () => {
  it("default 模式：只读放行", () => {
    expect(evaluate("default", "file", false)).toBe("allow");
  });

  it("default 模式：编辑需确认", () => {
    expect(evaluate("default", "file", true)).toBe("ask");
  });

  it("default 模式：shell 需确认", () => {
    expect(evaluate("default", "shell", true)).toBe("ask");
  });

  it("acceptsEdit 模式：编辑放行", () => {
    expect(evaluate("acceptsEdit", "file", true)).toBe("allow");
  });

  it("acceptsEdit 模式：shell 仍需确认", () => {
    expect(evaluate("acceptsEdit", "shell", true)).toBe("ask");
  });

  it("plan 模式：编辑拒绝", () => {
    expect(evaluate("plan", "file", true)).toBe("deny");
  });

  it("plan 模式：shell 拒绝", () => {
    expect(evaluate("plan", "shell", true)).toBe("deny");
  });

  it("plan 模式：只读放行", () => {
    expect(evaluate("plan", "file", false)).toBe("allow");
  });

  it("bypassPermissions 模式：全部放行", () => {
    expect(evaluate("bypassPermissions", "file", true)).toBe("allow");
    expect(evaluate("bypassPermissions", "shell", true)).toBe("allow");
    expect(evaluate("bypassPermissions", "file", false)).toBe("allow");
  });
});
