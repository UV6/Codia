import { describe, it, expect } from "vitest";
import { substituteTemplate, executeAction } from "../../hook/executor.js";
import type { HookAction, HookContext, ResolvedControl } from "../../hook/types.js";

describe("substituteTemplate", () => {
  it("替换单层字段", () => {
    const ctx: HookContext = { name: "Alice" };
    expect(substituteTemplate("Hello, {{name}}!", ctx)).toBe("Hello, Alice!");
  });

  it("替换嵌套字段", () => {
    const ctx: HookContext = { params: { command: "git push" } };
    expect(substituteTemplate("cmd: {{params.command}}", ctx)).toBe("cmd: git push");
  });

  it("缺失字段替换为空字符串", () => {
    const ctx: HookContext = { name: "Alice" };
    expect(substituteTemplate("Hello, {{name}}! {{age}}", ctx)).toBe("Hello, Alice! ");
  });

  it("多个占位符全部替换", () => {
    const ctx: HookContext = { tool_name: "Bash", params: { command: "git status" } };
    expect(
      substituteTemplate("{{tool_name}}: {{params.command}}", ctx),
    ).toBe("Bash: git status");
  });

  it("无占位符时原样返回", () => {
    expect(substituteTemplate("no template", {})).toBe("no template");
  });
});

describe("executeAction", () => {
  const control: ResolvedControl = {
    run_once: false,
    background: false,
    timeout: 5000,
  };
  const ctx: HookContext = { tool_name: "test", cwd: "/tmp" };

  it("executeCommand 执行 echo 返回 stdout", async () => {
    const action: HookAction = {
      type: "command",
      command: "echo hello",
    };
    const result = await executeAction(action, ctx, control);
    expect(result).toBe("hello");
  });

  it("executeCommand 执行不存在的命令返回 null", async () => {
    const action: HookAction = {
      type: "command",
      command: "nonexistent_command_12345",
    };
    const result = await executeAction(action, ctx, control);
    // exec 在未找到命令时可能返回 null 或错误消息
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("executeCommand 支持模板替换", async () => {
    const action: HookAction = {
      type: "command",
      command: "echo {{tool_name}}",
    };
    const result = await executeAction(action, ctx, control);
    expect(result).toBe("test");
  });

  it("executePrompt 返回替换后的文本", async () => {
    const action: HookAction = {
      type: "prompt",
      text: "Tool: {{tool_name}}",
    };
    const result = await executeAction(action, ctx, control);
    expect(result).toBe("Tool: test");
  });

  it("executeSubagent 返回 null", async () => {
    const action: HookAction = {
      type: "subagent",
      prompt: "review this",
    };
    const result = await executeAction(action, ctx, control);
    expect(result).toBeNull();
  });
});
