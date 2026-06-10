import { describe, it, expect } from "vitest";
import { isSuccessfulExit } from "../tool/command-exit-map.js";

describe("isSuccessfulExit", () => {
  it("grep 退出码 0 和 1 都是正常", () => {
    expect(isSuccessfulExit("grep", 0)).toBe(true);
    expect(isSuccessfulExit("grep", 1)).toBe(true);
    expect(isSuccessfulExit("grep", 2)).toBe(false);
  });

  it("diff 退出码 0 和 1 都是正常", () => {
    expect(isSuccessfulExit("diff", 0)).toBe(true);
    expect(isSuccessfulExit("diff", 1)).toBe(true);
    expect(isSuccessfulExit("diff", 2)).toBe(false);
  });

  it("cat 只有 0 正常", () => {
    expect(isSuccessfulExit("cat", 0)).toBe(true);
    expect(isSuccessfulExit("cat", 1)).toBe(false);
  });

  it("未列出的命令默认只有 0 正常", () => {
    expect(isSuccessfulExit("node", 0)).toBe(true);
    expect(isSuccessfulExit("node", 1)).toBe(false);
  });

  it("带路径的命令提取 basename", () => {
    expect(isSuccessfulExit("/usr/bin/grep abc", 1)).toBe(true);
    expect(isSuccessfulExit("/bin/cat file", 1)).toBe(false);
  });
});
