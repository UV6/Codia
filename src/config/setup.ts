import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import type { ChatConfig } from "../provider/types.js";

export type SetupPresetId = "openai" | "anthropic" | "deepseek";

export interface SetupPreset {
  id: SetupPresetId;
  label: string;
  description: string;
  protocol: ChatConfig["protocol"];
  defaultModel: string;
  defaultBaseUrl: string;
}

export interface SetupPrompter {
  choosePreset(presets: SetupPreset[]): Promise<SetupPreset>;
  ask(question: string, defaultValue?: string): Promise<string>;
  close(): void;
}

export interface SetupResult {
  path: string;
  preset: SetupPreset;
  config: ChatConfig;
}

const SETUP_PRESETS: SetupPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "适用于 OpenAI 官方 API 或兼容的中转服务",
    protocol: "openai",
    defaultModel: "gpt-5.4",
    defaultBaseUrl: "https://api.openai.com",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "适用于 Claude API",
    protocol: "anthropic",
    defaultModel: "claude-opus-4-6",
    defaultBaseUrl: "https://api.anthropic.com",
  },
  {
    id: "deepseek",
    label: "DeepSeek (OpenAI 兼容)",
    description: "适用于 DeepSeek 官方 API",
    protocol: "openai",
    defaultModel: "deepseek-v4-flash",
    defaultBaseUrl: "https://api.deepseek.com",
  },
];

export function getSetupPresets(): SetupPreset[] {
  return [...SETUP_PRESETS];
}

export function renderConfigYaml(config: ChatConfig): string {
  return [
    `protocol: ${config.protocol}`,
    `model: ${config.model}`,
    `base_url: ${config.baseUrl}`,
    `api_key: ${config.apiKey}`,
    "",
  ].join("\n");
}

export function saveConfigFile(path: string, config: ChatConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderConfigYaml(config), "utf-8");
}

export async function runConfigSetup(
  path: string,
  prompter: SetupPrompter,
): Promise<SetupResult> {
  const preset = await prompter.choosePreset(getSetupPresets());
  const model = await prompter.ask("模型", preset.defaultModel);
  const baseUrl = await prompter.ask("API Base URL", preset.defaultBaseUrl);
  const apiKey = await prompter.ask("API Key");

  const config: ChatConfig = {
    protocol: preset.protocol,
    model: model || preset.defaultModel,
    baseUrl: (baseUrl || preset.defaultBaseUrl).replace(/\/+$/, ""),
    apiKey,
  };

  saveConfigFile(path, config);

  return {
    path,
    preset,
    config,
  };
}

export function createCliSetupPrompter(): SetupPrompter {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    async choosePreset(presets: SetupPreset[]): Promise<SetupPreset> {
      console.log("未检测到配置文件，开始初始化 Codia。");
      console.log("");
      console.log("请选择要使用的协议服务：");
      presets.forEach((preset, index) => {
        console.log(`  ${index + 1}. ${preset.label} - ${preset.description}`);
      });
      console.log("");

      while (true) {
        const answer = (await rl.question(`输入编号 [1-${presets.length}] (默认 1): `)).trim();
        if (answer === "") {
          return presets[0];
        }

        const index = Number(answer);
        if (Number.isInteger(index) && index >= 1 && index <= presets.length) {
          return presets[index - 1];
        }

        console.log(`请输入 1 到 ${presets.length} 之间的编号。`);
      }
    },

    async ask(question: string, defaultValue?: string): Promise<string> {
      const suffix = defaultValue ? ` [默认: ${defaultValue}]` : "";
      const answer = (await rl.question(`${question}${suffix}: `)).trim();
      if (answer === "" && defaultValue !== undefined) {
        return defaultValue;
      }
      return answer;
    },

    close(): void {
      rl.close();
    },
  };
}
