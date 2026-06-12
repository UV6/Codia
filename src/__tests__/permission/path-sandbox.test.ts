import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { check as checkSandbox } from "../../permission/path-sandbox.js";
import type { PermissionRequest } from "../../permission/types.js";

describe("PathSandbox (Layer 2)", () => {
  const testDir = join(tmpdir(), `codia-sandbox-test-${Date.now()}`);
  const outsideDir = join(tmpdir(), `codia-sandbox-outside-${Date.now()}`);

  // 创建测试目录
  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "test.txt"), "hello");
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, "outside.txt"), "outside");
  });

  afterAll(() => {
    // 清理临时目录
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
    try { rmSync(outsideDir, { recursive: true, force: true }); } catch {}
  });

  function makeRequest(
    toolType: "file" | "shell" | "search",
    params: Record<string, unknown>,
  ): PermissionRequest {
    return {
      toolName: "write_file",
      toolType,
      destructive: toolType !== "file" ? true : false,
      params,
      cwd: testDir,
    };
  }

  it("非文件工具返回 null（不适用）", () => {
    const result = checkSandbox(
      makeRequest("shell", { command: "ls" }),
    );
    expect(result).toBeNull();
  });

  it("search 类型工具返回 null", () => {
    const result = checkSandbox(
      makeRequest("search", { pattern: "*.ts" }),
    );
    expect(result).toBeNull();
  });

  it("项目目录内文件路径放行", () => {
    const result = checkSandbox(
      makeRequest("file", { filePath: "test.txt" }),
    );
    expect(result).toBeNull();
  });

  it("项目目录内绝对路径放行", () => {
    const result = checkSandbox(
      makeRequest("file", { filePath: join(testDir, "new.txt") }),
    );
    expect(result).toBeNull();
  });

  it("绝对路径在项目外被拒绝", () => {
    const result = checkSandbox(
      makeRequest("file", { filePath: join(outsideDir, "outside.txt") }),
    );
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
    expect(result!.layer).toBe(2);
  });

  it("相对路径 ../ 逃逸被拒绝", () => {
    const result = checkSandbox(
      makeRequest("file", { filePath: "../outside.txt" }),
    );
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
    expect(result!.layer).toBe(2);
  });

  it("无路径参数时返回 null", () => {
    const result = checkSandbox(
      makeRequest("file", { content: "hello" }),
    );
    expect(result).toBeNull();
  });
});
