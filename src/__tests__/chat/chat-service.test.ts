import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChatService } from "../../chat/chat-service.js";
import type { ChatConfig } from "../../provider/types.js";
import { ToolRegistry } from "../../tool/registry.js";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const testConfig: ChatConfig = {
  protocol: "anthropic",
  model: "test-model",
  baseUrl: "https://example.com",
  apiKey: "test-key",
};

describe("ChatService", () => {
  const previousCodiaHome = process.env.CODIA_HOME;
  let projectRoot: string;
  let codiaHome: string;

  beforeEach(() => {
    const id = randomUUID().slice(0, 8);
    projectRoot = join(tmpdir(), `codia-chat-service-project-${id}`);
    codiaHome = join(tmpdir(), `codia-chat-service-home-${id}`, ".codia");
    mkdirSync(projectRoot, { recursive: true });
    process.env.CODIA_HOME = codiaHome;
  });

  afterEach(() => {
    try {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(join(codiaHome, ".."), { recursive: true, force: true });
    } catch {}

    if (previousCodiaHome === undefined) {
      delete process.env.CODIA_HOME;
    } else {
      process.env.CODIA_HOME = previousCodiaHome;
    }
  });

  it("fullSystemPrompt 注入当前可用的内置 Agent 角色", async () => {
    const service = await ChatService.create(testConfig, {
      projectRoot,
    });

    const prompt = (service as unknown as { fullSystemPrompt: string }).fullSystemPrompt;

    expect(prompt).toContain("当前会话可用的预定义子 Agent 角色如下");
    expect(prompt).toContain("Explore");
    expect(prompt).toContain("Plan");
    expect(prompt).toContain("general-purpose");
    expect(prompt).toContain("Verification");
  });

  it("启动时注册 CreateTeam 工具", async () => {
    const service = await ChatService.create(testConfig, {
      projectRoot,
    });

    const registry = (service as unknown as { registry: ToolRegistry }).registry;

    expect(registry.get("CreateTeam")).toBeDefined();
  });

  it("acceptsEdit 模式下可创建 team 到用户目录", async () => {
    const service = await ChatService.create(testConfig, {
      projectRoot,
      permissionMode: "acceptsEdit",
    });

    const team = await service.createTeam("alpha", "alice");

    expect(team).toEqual({ name: "alpha", lead: "alice" });
    expect(existsSync(join(codiaHome, "teams", "alpha", "group.json"))).toBe(true);
  });

  it("plan 模式下拒绝创建 team", async () => {
    const service = await ChatService.create(testConfig, {
      projectRoot,
      permissionMode: "plan",
    });

    await expect(service.createTeam("beta", "bob")).rejects.toThrow("权限被拒绝");
    expect(existsSync(join(codiaHome, "teams", "beta", "group.json"))).toBe(false);
  });
});
