import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { saveResult, loadResult } from "../../context/store.js";
import { existsSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_SESSION_ID = "test-store-2026-06-16";
const previousCodiaHome = process.env.CODIA_HOME;
const CONTEXT_DIR = join(tmpdir(), "codia-context-store-test", ".codia", "context");

describe("ContextStore", () => {
  beforeAll(() => {
    process.env.CODIA_HOME = join(tmpdir(), "codia-context-store-test", ".codia");
    // 确保测试目录存在
    mkdirSync(join(CONTEXT_DIR, TEST_SESSION_ID), { recursive: true });
  });

  afterAll(() => {
    // 清理测试文件
    const testDir = join(CONTEXT_DIR, TEST_SESSION_ID);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    if (previousCodiaHome === undefined) {
      delete process.env.CODIA_HOME;
    } else {
      process.env.CODIA_HOME = previousCodiaHome;
    }
  });

  it("写入结果并返回文件路径", () => {
    const content = "这是测试内容\n第二行";
    const path = saveResult(TEST_SESSION_ID, content, {
      type: "tool_result",
      timestamp: "2026-06-16T10:30:00.000Z",
    });

    expect(path).toContain(CONTEXT_DIR);
    expect(path).toContain(TEST_SESSION_ID);
    expect(path).toContain("result_");
    expect(path).toContain(".json");
    expect(existsSync(path)).toBe(true);
  });

  it("写入的文件包含 meta 和 content", () => {
    const content = "测试内容 ABC";
    const path = saveResult(TEST_SESSION_ID, content, {
      type: "summary",
      timestamp: "2026-06-16T11:00:00.000Z",
    });

    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw);

    expect(data.meta.type).toBe("summary");
    expect(data.meta.timestamp).toBe("2026-06-16T11:00:00.000Z");
    expect(data.content).toBe("测试内容 ABC");
  });

  it("loadResult 返回 content 字段", () => {
    const content = "需要被读取的内容";
    const path = saveResult(TEST_SESSION_ID, content, {
      type: "tool_result",
      timestamp: new Date().toISOString(),
    });

    const loaded = loadResult(path);
    expect(loaded).toBe(content);
  });

  it("自动创建嵌套目录", () => {
    const deepSessionId = "test-store-2026-06-16/deep/nested";
    const content = "嵌套目录测试";
    const path = saveResult(deepSessionId, content, {
      type: "tool_result",
      timestamp: new Date().toISOString(),
    });

    expect(existsSync(path)).toBe(true);

    // 清理
    const deepDir = join(CONTEXT_DIR, "test-store-2026-06-16/deep");
    if (existsSync(deepDir)) {
      rmSync(join(CONTEXT_DIR, "test-store-2026-06-16/deep"), { recursive: true, force: true });
    }
  });

  it("文件名中的时间戳格式可排序", () => {
    // 写入两个不同时间戳的结果，验证文件名按时间排序
    const result = "测试";
    const path1 = saveResult(TEST_SESSION_ID, result, {
      type: "tool_result",
      timestamp: "2026-06-16T10:00:00.000Z",
    });
    const path2 = saveResult(TEST_SESSION_ID, result, {
      type: "tool_result",
      timestamp: "2026-06-16T11:00:00.000Z",
    });

    // 较早的时间戳应在字典序上更小
    expect(path1 < path2).toBe(true);
  });
});
