import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getSetupPresets,
  renderConfigYaml,
  runConfigSetup,
  type SetupPreset,
  type SetupPrompter,
} from "../../config/setup.js";

class FakePrompter implements SetupPrompter {
  constructor(
    private readonly preset: SetupPreset,
    private readonly answers: string[],
  ) {}

  async choosePreset(): Promise<SetupPreset> {
    return this.preset;
  }

  async ask(): Promise<string> {
    return this.answers.shift() ?? "";
  }

  close(): void {}
}

describe("config setup", () => {
  it("提供 OpenAI、Anthropic、DeepSeek 三种预设", () => {
    const presets = getSetupPresets();
    expect(presets.map((preset) => preset.id)).toEqual(["openai", "anthropic", "deepseek"]);
    expect(presets[0].defaultModel).toBe("gpt-5.4");
    expect(presets[1].defaultModel).toBe("claude-opus-4-6");
    expect(presets[2].defaultModel).toBe("deepseek-v4-flash");
  });

  it("把配置渲染为项目约定的 YAML 格式", () => {
    expect(
      renderConfigYaml({
        protocol: "openai",
        model: "gpt-5.4",
        baseUrl: "https://api.openai.com",
        apiKey: "test-key",
      }),
    ).toBe(
      [
        "protocol: openai",
        "model: gpt-5.4",
        "base_url: https://api.openai.com",
        "api_key: test-key",
        "",
      ].join("\n"),
    );
  });

  it("根据问答结果写入配置文件", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "codia-setup-")), "Codia.yml");
    const preset = getSetupPresets().find((item) => item.id === "deepseek");
    const result = await runConfigSetup(
      path,
      new FakePrompter(preset!, ["", "", "deepseek-key"]),
    );

    expect(result.config).toEqual({
      protocol: "openai",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      apiKey: "deepseek-key",
    });
    expect(readFileSync(path, "utf-8")).toContain("model: deepseek-v4-flash");
  });
});
