import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { expandEnvVars, validateServerConfig } from "../../mcp/config.js";

// config.test.ts 只测试 expandEnvVars 和校验逻辑（纯函数，不依赖文件系统）
// 完整配置读取/合并的集成测试在 E2E 场景中验证

describe("expandEnvVars", () => {
  beforeEach(() => {
    process.env.TEST_VAR = "hello";
    process.env.TEST_EMPTY = "";
  });

  afterEach(() => {
    delete process.env.TEST_VAR;
    delete process.env.TEST_EMPTY;
  });

  it("替换 ${VAR} 为环境变量值", () => {
    expect(expandEnvVars("Bearer ${TEST_VAR}")).toBe("Bearer hello");
  });

  it("未设置的环境变量替换为空字符串", () => {
    expect(expandEnvVars("${NOT_SET}")).toBe("");
  });

  it("不含变量的字符串原样返回", () => {
    expect(expandEnvVars("plain text")).toBe("plain text");
  });

  it("多个变量同时替换", () => {
    expect(expandEnvVars("${TEST_VAR}-${TEST_EMPTY}-end")).toBe("hello--end");
  });
});

describe("validateServerConfig", () => {
  it("stdio 缺少 command 报错", () => {
    const errors = validateServerConfig("test", { type: "stdio" });
    expect(errors.some((e) => e.includes("command"))).toBe(true);
  });

  it("http 缺少 url 报错", () => {
    const errors = validateServerConfig("test", { type: "http" });
    expect(errors.some((e) => e.includes("url"))).toBe(true);
  });

  it("name 含下划线报错", () => {
    const errors = validateServerConfig("my_server", {
      type: "stdio",
      command: "echo",
    });
    expect(errors.some((e) => e.includes("下划线"))).toBe(true);
  });

  it("不支持的 type 报错", () => {
    const errors = validateServerConfig("test", {
      type: "other" as "stdio",
    });
    expect(errors.some((e) => e.includes("不支持的"))).toBe(true);
  });

  it("合法配置不报错", () => {
    const errors = validateServerConfig("valid-name", {
      type: "stdio",
      command: "echo",
      args: ["hello"],
    });
    expect(errors).toHaveLength(0);
  });
});
