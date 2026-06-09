import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "../config/index.js";

describe("loadConfig", () => {
  it("正确读取有效 YAML 配置", () => {
    const config = loadConfig();
    expect(config.protocol).toBeTruthy();
    expect(config.model).toBeTruthy();
    expect(config.baseUrl).toBeTruthy();
    expect(config.apiKey).toBeTruthy();
  });

  it("文件不存在时抛 ConfigError", () => {
    expect(() => loadConfig("/tmp/nonexistent-config-for-test.yaml")).toThrow(ConfigError);
  });
});
