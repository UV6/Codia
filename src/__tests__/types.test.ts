import { describe, it, expect } from "vitest";
import type { Message, ChatConfig, Chunk, LLMProvider } from "../provider/types.js";

describe("类型定义冒烟测试", () => {
  it("可以创建 Message 对象", () => {
    const msg: Message = {
      role: "user",
      content: "你好",
      timestamp: new Date().toISOString(),
    };
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("你好");
  });

  it("Message 支持 usage 和 thinking 可选字段", () => {
    const msg: Message = {
      role: "assistant",
      content: "你好！",
      timestamp: new Date().toISOString(),
      usage: { inputTokens: 10, outputTokens: 20, model: "test" },
      thinking: "用户说你好，我应该回应...",
    };
    expect(msg.usage?.inputTokens).toBe(10);
    expect(msg.thinking).toBeTruthy();
  });

  it("ChatConfig 协议字段只能是 anthropic 或 openai", () => {
    const config: ChatConfig = {
      protocol: "anthropic",
      model: "claude-sonnet-4-6",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test",
    };
    // type-level test: 下面这行如果取消注释会产生类型错误
    // config.protocol = "invalid";
    expect(config.protocol).toBe("anthropic");
  });

  it("Chunk 联合类型可以被正确识别", () => {
    const textChunk: Chunk = { type: "text", content: "你好" };
    const doneChunk: Chunk = { type: "done" };
    const errorChunk: Chunk = {
      type: "error",
      error: { code: "network", message: "连接失败" },
    };

    expect(textChunk.type).toBe("text");
    expect(doneChunk.type).toBe("done");
    expect(errorChunk.type).toBe("error");
  });
});
