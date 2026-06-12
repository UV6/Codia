import { describe, it, expect } from "vitest";
import { check } from "../../permission/blocklist.js";

describe("Blocklist (Layer 1)", () => {
  it("拦截 rm -rf /", () => {
    const result = check("rm -rf /");
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
    expect(result!.layer).toBe(1);
  });

  it("拦截 mkfs 命令", () => {
    const result = check("mkfs.ext4 /dev/sda1");
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
    expect(result!.layer).toBe(1);
  });

  it("拦截 dd 写盘", () => {
    const result = check("dd if=/dev/zero of=/dev/sda");
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
  });

  it("拦截 fork 炸弹", () => {
    const result = check(":(){ :|:& };:");
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
  });

  it("放行正常的 git status", () => {
    const result = check("git status");
    expect(result).toBeNull();
  });

  it("放行 echo 命令", () => {
    const result = check("echo hello world");
    expect(result).toBeNull();
  });

  it("放行安全的文件操作命令", () => {
    const result = check("ls -la");
    expect(result).toBeNull();
  });

  it("空字符串返回 null", () => {
    const result = check("");
    expect(result).toBeNull();
  });

  it("非字符串返回 null", () => {
    const result = check(undefined);
    expect(result).toBeNull();
  });

  it("npm install 放行", () => {
    const result = check("npm install express");
    expect(result).toBeNull();
  });
});
