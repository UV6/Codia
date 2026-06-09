import type { ChatConfig, LLMProvider } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";

// createProvider —— 根据配置创建对应的 LLM Provider 实例
export function createProvider(config: ChatConfig): LLMProvider {
  switch (config.protocol) {
    case "anthropic":
      return new AnthropicProvider();
    case "openai":
      return new OpenAIProvider();
    default:
      throw new Error(`未知的 protocol：${(config as ChatConfig).protocol}`);
  }
}
