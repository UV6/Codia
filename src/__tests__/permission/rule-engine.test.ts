import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { RuleEngine } from "../../permission/rule-engine.js";
import type { PermissionRequest } from "../../permission/types.js";

describe("RuleEngine (Layer 3)", () => {
  const baseDir = join(tmpdir(), `codia-re-test-${Date.now()}`);
  const globalPath = join(baseDir, "global", "permissions.yaml");
  const projectPath = join(baseDir, "project", "permissions.yaml");
  const localPath = join(baseDir, "project", "permissions.local.yaml");

  function makeRequest(
    toolName: string,
    params: Record<string, unknown>,
  ): PermissionRequest {
    return {
      toolName,
      toolType: toolName === "run_command" ? "shell" : "file",
      destructive: toolName !== "read_file" && toolName !== "glob" && toolName !== "grep",
      params,
      cwd: "/tmp",
    };
  }

  async function setupEngine(): Promise<RuleEngine> {
    const engine = new RuleEngine(globalPath, projectPath, localPath);
    await engine.load();
    return engine;
  }

  beforeEach(() => {
    mkdirSync(join(baseDir, "global"), { recursive: true });
    mkdirSync(join(baseDir, "project"), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(baseDir, { recursive: true, force: true }); } catch {}
  });

  it("文件不存在时不报错，返回 null", async () => {
    const engine = await setupEngine();
    const result = engine.check(makeRequest("run_command", { command: "git status" }));
    expect(result).toBeNull();
  });

  it("精确匹配规则生效（allow）", async () => {
    writeFileSync(
      projectPath,
      'rules:\n  - "Bash(git status): allow"\n',
      "utf-8",
    );
    const engine = await setupEngine();
    const result = engine.check(makeRequest("run_command", { command: "git status" }));
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("allow");
    expect(result!.layer).toBe(3);
  });

  it("glob 匹配规则生效", async () => {
    writeFileSync(
      projectPath,
      'rules:\n  - "Bash(git *): allow"\n',
      "utf-8",
    );
    const engine = await setupEngine();
    const result = engine.check(makeRequest("run_command", { command: "git pull" }));
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("allow");
  });

  it("deny 规则生效", async () => {
    writeFileSync(
      projectPath,
      'rules:\n  - "Bash(rm *): deny"\n',
      "utf-8",
    );
    const engine = await setupEngine();
    const result = engine.check(makeRequest("run_command", { command: "rm -rf build" }));
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
  });

  it("deny-anywhere: 本地 deny 覆盖项目 allow", async () => {
    writeFileSync(
      projectPath,
      'rules:\n  - "Bash(npm *): allow"\n',
      "utf-8",
    );
    writeFileSync(
      localPath,
      'rules:\n  - "Bash(npm publish): deny"\n',
      "utf-8",
    );
    const engine = await setupEngine();
    const result = engine.check(makeRequest("run_command", { command: "npm publish" }));
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
  });

  it("无匹配规则返回 null", async () => {
    writeFileSync(
      projectPath,
      'rules:\n  - "Bash(git *): allow"\n',
      "utf-8",
    );
    const engine = await setupEngine();
    const result = engine.check(makeRequest("run_command", { command: "npm install" }));
    expect(result).toBeNull();
  });

  it("addRule 添加临时规则并生效", async () => {
    const engine = await setupEngine();
    engine.addRule({
      toolPattern: "Bash",
      paramPattern: "echo *",
      action: "allow",
      source: "session",
    });
    const result = engine.check(makeRequest("run_command", { command: "echo hello" }));
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("allow");
    expect(result!.ruleSource).toBe("session");
  });

  it("persistRule 持久化规则到文件", async () => {
    const engine = await setupEngine();
    await engine.persistRule({
      toolPattern: "Read",
      paramPattern: "*.md",
      action: "allow",
      source: "local",
    });

    // 重新加载检查规则是否持久化
    const engine2 = await setupEngine();
    const result = engine2.check(makeRequest("read_file", { filePath: "README.md" }));
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("allow");
  });

  it("简写语法 Bash: allow 匹配所有 Bash 调用", async () => {
    writeFileSync(
      projectPath,
      'rules:\n  - "Bash: allow"\n',
      "utf-8",
    );
    const engine = await setupEngine();
    const result = engine.check(makeRequest("run_command", { command: "anything" }));
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("allow");
  });
});
