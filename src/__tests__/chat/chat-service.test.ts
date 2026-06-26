import { describe, it, expect } from "vitest";
import { ChatService } from "../../chat/chat-service.js";
import type { ChatConfig } from "../../provider/types.js";

const testConfig: ChatConfig = {
  protocol: "anthropic",
  model: "test-model",
  baseUrl: "https://example.com",
  apiKey: "test-key",
};

describe("ChatService", () => {
  it("fullSystemPrompt 注入当前可用的内置 Agent 角色", async () => {
    const service = await ChatService.create(testConfig, {
      projectRoot: "/tmp/codia-chat-service-test",
    });

    const prompt = (service as unknown as { fullSystemPrompt: string }).fullSystemPrompt;

    expect(prompt).toContain("当前会话可用的预定义子 Agent 角色如下");
    expect(prompt).toContain("Explore");
    expect(prompt).toContain("Plan");
    expect(prompt).toContain("general-purpose");
    expect(prompt).toContain("Verification");
  });
});
