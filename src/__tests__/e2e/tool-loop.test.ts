import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { loadConfig } from "../../config/index.js";
import { ChatService } from "../../chat/chat-service.js";

const previousCodiaHome = process.env.CODIA_HOME;
const testCodiaHome = join(tmpdir(), "codia-e2e-tool-loop-home", ".codia");

describe("E2E: 工具调用循环", () => {
  beforeAll(() => {
    process.env.CODIA_HOME = testCodiaHome;
  });

  afterAll(() => {
    try { rmSync(join(tmpdir(), "codia-e2e-tool-loop-home"), { recursive: true, force: true }); } catch {}
    if (previousCodiaHome === undefined) {
      delete process.env.CODIA_HOME;
    } else {
      process.env.CODIA_HOME = previousCodiaHome;
    }
  });

  // 跳过此测试需要 API key 才能运行
  const SKIP_REASON = configNotAvailable();

  it.skipIf(SKIP_REASON !== null)(SKIP_REASON ?? "集成测试: read_file", async () => {
    const config = loadConfig();
    const svc = await ChatService.create(config, {
      resume: undefined, // 新会话
    });

    const chunks: string[] = [];
    let toolStatusSeen = false;
    let toolUseSeen = false;
    let finalText = "";

    for await (const chunk of svc.sendMessage("读取 package.json 的内容")) {
      chunks.push(chunk.type);

      if (chunk.type === "tool_status") {
        toolStatusSeen = true;
      }
      if (chunk.type === "tool_use") {
        toolUseSeen = true;
      }
      if (chunk.type === "text") {
        finalText += chunk.content;
      }
    }

    console.log("Chunk types:", chunks.join(" → "));
    console.log("Tool status seen:", toolStatusSeen);
    console.log("Tool use seen:", toolUseSeen);
    console.log("Final text preview:", finalText.slice(0, 200));

    expect(toolStatusSeen).toBe(true);
    expect(toolUseSeen).toBe(true);
    expect(finalText.length).toBeGreaterThan(10);
  }, 60000);

  it.skipIf(SKIP_REASON !== null)(SKIP_REASON ?? "集成测试: run_command", async () => {
    const config = loadConfig();
    const svc = await ChatService.create(config, {
      resume: undefined, // 新会话
    });

    const chunks: string[] = [];
    let toolUseSeen = false;
    let finalText = "";

    for await (const chunk of svc.sendMessage("执行 ls -la")) {
      chunks.push(chunk.type);
      if (chunk.type === "tool_use") toolUseSeen = true;
      if (chunk.type === "text") finalText += chunk.content;
    }

    console.log("Chunk types:", chunks.join(" → "));
    console.log("Tool use seen:", toolUseSeen);

    expect(toolUseSeen).toBe(true);
    expect(finalText.length).toBeGreaterThan(0);
  }, 60000);
});

function configNotAvailable(): string | null {
  if (process.env.CODIA_RUN_E2E !== "1") {
    return "SKIP: 未启用 E2E";
  }
  try {
    const config = loadConfig();
    if (config.apiKey === "YOUR_API_KEY_HERE") {
      return "SKIP: apiKey 未配置";
    }
    return null;
  } catch {
    return "SKIP: 配置文件不存在";
  }
}
