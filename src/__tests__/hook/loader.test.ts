import { describe, it, expect } from "vitest";
import { validateRule } from "../../hook/loader.js";

describe("validateRule", () => {
  const source = "test.yaml";

  it("合法 command 规则返回空数组", () => {
    const errors = validateRule(
      {
        event: "pre_tool",
        action: { type: "command", command: "echo hello" },
      },
      source,
    );
    expect(errors).toEqual([]);
  });

  it("合法 prompt 规则返回空数组", () => {
    const errors = validateRule(
      {
        event: "pre_llm",
        action: { type: "prompt", text: "hello" },
      },
      source,
    );
    expect(errors).toEqual([]);
  });

  it("合法 http 规则返回空数组", () => {
    const errors = validateRule(
      {
        event: "post_tool",
        action: { type: "http", url: "https://example.com" },
      },
      source,
    );
    expect(errors).toEqual([]);
  });

  it("合法 subagent 规则返回空数组", () => {
    const errors = validateRule(
      {
        event: "turn_start",
        action: { type: "subagent", prompt: "review this" },
      },
      source,
    );
    expect(errors).toEqual([]);
  });

  it("带 condition 的合法规则通过", () => {
    const errors = validateRule(
      {
        event: "pre_tool",
        if: { match: "all", fields: [{ field: "tool_name", equals: "Bash" }] },
        action: { type: "command", command: "echo hello" },
      },
      source,
    );
    expect(errors).toEqual([]);
  });

  it("非对象规则返回错误", () => {
    const errors = validateRule("not an object", source);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("必须为对象");
  });

  it("缺失 event 返回错误", () => {
    const errors = validateRule(
      { action: { type: "command", command: "echo" } },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("event");
  });

  it("未知事件名返回错误", () => {
    const errors = validateRule(
      { event: "unknown_event", action: { type: "command", command: "echo" } },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("未知事件");
  });

  it("缺失 action 返回错误", () => {
    const errors = validateRule({ event: "pre_tool" }, source);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("action");
  });

  it("未知动作类型返回错误", () => {
    const errors = validateRule(
      { event: "pre_tool", action: { type: "unknown_type" } },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("action.type");
  });

  it("command 动作缺 command 字段返回错误", () => {
    const errors = validateRule(
      { event: "pre_tool", action: { type: "command" } },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("command");
  });

  it("prompt 动作缺 text 字段返回错误", () => {
    const errors = validateRule(
      { event: "pre_llm", action: { type: "prompt" } },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("text");
  });

  it("http 动作缺 url 字段返回错误", () => {
    const errors = validateRule(
      { event: "post_tool", action: { type: "http" } },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("url");
  });

  it("subagent 动作缺 prompt 字段返回错误", () => {
    const errors = validateRule(
      { event: "turn_start", action: { type: "subagent" } },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("prompt");
  });

  it("拦截事件设 background: true 返回错误", () => {
    const errors = validateRule(
      {
        event: "pre_tool",
        action: { type: "command", command: "echo" },
        control: { background: true },
      },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("background");
  });

  it("timeout 非正整数返回错误", () => {
    const errors = validateRule(
      {
        event: "turn_start",
        action: { type: "command", command: "echo" },
        control: { timeout: -1 },
      },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("timeout");
  });

  it("timeout 为 0 返回错误", () => {
    const errors = validateRule(
      {
        event: "turn_start",
        action: { type: "command", command: "echo" },
        control: { timeout: 0 },
      },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("timeout");
  });

  it("if.match 非法值返回错误", () => {
    const errors = validateRule(
      {
        event: "turn_start",
        if: { match: "invalid", fields: [{ field: "tool_name", equals: "Bash" }] },
        action: { type: "command", command: "echo" },
      },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("match");
  });

  it("if.fields 为空数组时通过（归一化为无条件）", () => {
    const errors = validateRule(
      {
        event: "turn_start",
        if: { match: "all", fields: [] },
        action: { type: "command", command: "echo" },
      },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("field 条件缺少 field 字段返回错误", () => {
    const errors = validateRule(
      {
        event: "turn_start",
        if: { match: "all", fields: [{ equals: "Bash" }] },
        action: { type: "command", command: "echo" },
      },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("field"))).toBe(true);
  });

  it("field 条件缺少匹配模式返回错误", () => {
    const errors = validateRule(
      {
        event: "turn_start",
        if: { match: "all", fields: [{ field: "tool_name" }] },
        action: { type: "command", command: "echo" },
      },
      source,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("匹配模式"))).toBe(true);
  });
});
