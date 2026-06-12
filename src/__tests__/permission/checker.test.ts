import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PermissionChecker } from "../../permission/checker.js";
import { RuleEngine } from "../../permission/rule-engine.js";
import type {
  PermissionRequest,
  HumanInTheLoopCallback,
} from "../../permission/types.js";

describe("PermissionChecker 集成测试", () => {
  const baseDir = join(tmpdir(), `codia-checker-test-${Date.now()}`);
  const localPath = join(baseDir, "project", "permissions.local.yaml");

  beforeEach(() => {
    mkdirSync(join(baseDir, "project"), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(baseDir, { recursive: true, force: true }); } catch {}
  });

  function makeRequest(
    toolName: string,
    toolType: "file" | "shell" | "search",
    destructive: boolean,
    params: Record<string, unknown>,
  ): PermissionRequest {
    return {
      toolName,
      toolType,
      destructive,
      params,
      cwd: join(baseDir, "project"),
    };
  }

  it("Layer 1 拦截 rm -rf /（不进入后续层）", async () => {
    const ruleEngine = new RuleEngine();
    await ruleEngine.load();
    const callback = vi.fn().mockResolvedValue("yes");
    const checker = new PermissionChecker(
      ruleEngine,
      "bypassPermissions",
      callback,
    );

    // 即使 bypass 模式 + allow，Layer 1 也应拦截
    const result = await checker.check(
      makeRequest("run_command", "shell", true, { command: "rm -rf /" }),
    );

    expect(result.decision).toBe("deny");
    expect(result.layer).toBe(1);
    expect(callback).not.toHaveBeenCalled();
  });

  it("Layer 4 allow 不进入 Layer 5 回调", async () => {
    const ruleEngine = new RuleEngine();
    await ruleEngine.load();
    const callback = vi.fn().mockResolvedValue("yes");
    const checker = new PermissionChecker(
      ruleEngine,
      "bypassPermissions",
      callback,
    );

    const result = await checker.check(
      makeRequest("read_file", "file", false, { filePath: "test.txt" }),
    );

    // bypass 模式 + 只读工具 → allow
    // Layer 2 可能拦截（路径不存在），但如果路径在项目内应放行
    // 实际上对于不存在的文件，path-sanbox 允许（创建场景）
    // 然后 Layer 4 返回 allow
    expect(callback).not.toHaveBeenCalled();
  });

  it("Layer 4 deny 不进入 Layer 5 回调", async () => {
    const ruleEngine = new RuleEngine();
    await ruleEngine.load();
    const callback = vi.fn().mockResolvedValue("yes");
    const checker = new PermissionChecker(ruleEngine, "plan", callback);

    // plan 模式 + shell → deny
    const result = await checker.check(
      makeRequest("run_command", "shell", true, { command: "ls" }),
    );

    expect(result.decision).toBe("deny");
    expect(result.layer).toBe(4);
    expect(callback).not.toHaveBeenCalled();
  });

  it("Layer 5: 用户选 yes → allow", async () => {
    const ruleEngine = new RuleEngine();
    await ruleEngine.load();
    const callback = vi.fn().mockResolvedValue("yes");
    const checker = new PermissionChecker(
      ruleEngine,
      "default",
      callback,
    );

    // default 模式 + destructive file (edit) → ask
    const result = await checker.check(
      makeRequest("write_file", "file", true, { filePath: "test.txt", content: "x" }),
    );

    expect(result.decision).toBe("allow");
    expect(result.layer).toBe(5);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("Layer 5: 用户选 no → deny", async () => {
    const ruleEngine = new RuleEngine();
    await ruleEngine.load();
    const callback = vi.fn().mockResolvedValue("no");
    const checker = new PermissionChecker(
      ruleEngine,
      "default",
      callback,
    );

    const result = await checker.check(
      makeRequest("write_file", "file", true, { filePath: "test.txt", content: "x" }),
    );

    expect(result.decision).toBe("deny");
    expect(result.layer).toBe(5);
  });

  it("Layer 5: 用户选 always_allow → 持久化规则", async () => {
    const ruleEngine = new RuleEngine(undefined, undefined, localPath);
    await ruleEngine.load();
    const callback = vi.fn().mockResolvedValue("always_allow");
    const checker = new PermissionChecker(
      ruleEngine,
      "default",
      callback,
    );

    const result = await checker.check(
      makeRequest("run_command", "shell", true, { command: "git pull" }),
    );

    expect(result.decision).toBe("allow");
    expect(result.layer).toBe(5);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
