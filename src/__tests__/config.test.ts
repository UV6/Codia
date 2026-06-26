import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { loadConfig, loadAppConfig, ConfigError } from "../config/index.js";

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

  it("默认关闭启动页宠物图案", () => {
    const dir = mkdtempSync(join(tmpdir(), "codia-config-"));
    const path = join(dir, "Codia.yml");
    writeFileSync(path, [
      "protocol: openai",
      "model: test-model",
      "base_url: https://example.com/v1",
      "api_key: test-key",
    ].join("\n"));

    const config = loadAppConfig(path);
    expect(config.ui.pet.enabled).toBe(false);
  });

  it("支持通过 ui.pet.enabled 显式开启宠物图案", () => {
    const dir = mkdtempSync(join(tmpdir(), "codia-config-"));
    const path = join(dir, "Codia.yml");
    writeFileSync(path, [
      "protocol: openai",
      "model: test-model",
      "base_url: https://example.com/v1",
      "api_key: test-key",
      "ui:",
      "  pet:",
      "    enabled: true",
    ].join("\n"));

    const config = loadAppConfig(path);
    expect(config.ui.pet.enabled).toBe(true);
  });
});
