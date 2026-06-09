import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "../config/index.js";

describe("loadConfig", () => {
  it("正确读取有效 YAML 配置", () => {
    const config = loadConfig("codia.yaml");
    expect(config.protocol).toBe("anthropic");
    expect(config.model).toBeTruthy();
    expect(config.baseUrl).toBe("https://api.anthropic.com");
    expect(config.apiKey).toBeTruthy();
  });

  it("文件不存在时抛 ConfigError", () => {
    expect(() => loadConfig("./nonexistent.yaml")).toThrow(ConfigError);
    try {
      loadConfig("./nonexistent.yaml");
    } catch (e) {
      const err = e as ConfigError;
      expect(err.code).toBe("not_found");
      expect(err instanceof ConfigError).toBe(true);
    }
  });

  it("格式错误时抛 ConfigError(invalid_format)", () => {
    // 需要预先创建测试文件
  });
});
