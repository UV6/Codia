import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { recoverSession } from "../../chat/recovery.js";
import { appendMessage } from "../../chat/history.js";
import type { Message } from "../../provider/types.js";

describe("recoverSession", () => {
  const testDir = join(tmpdir(), "codia-recovery-test");

  function cleanup() {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  }

  function setup() {
    cleanup();
    mkdirSync(testDir, { recursive: true });
  }

  function writeJsonl(filePath: string, messages: Message[]) {
    for (const m of messages) appendMessage(filePath, m);
  }

  it("恢复损坏行跳过后的正常会话", () => {
    setup();
    const fp = join(testDir, "test.jsonl");
    // 写入包含坏行的 JSONL
    writeFileSync(fp, [
      JSON.stringify({ role: "user", content: "hi", timestamp: "2026-01-01T00:00:00Z" }),
      "NOT VALID JSON",
      JSON.stringify({ role: "assistant", content: "hello", timestamp: "2026-01-01T00:00:01Z" }),
      "",
    ].join("\n"));

    const result = recoverSession({
      sessionId: "test",
      filePath: fp,
      now: new Date("2026-01-02"),
    });

    expect(result.messages.length).toBe(2);
    expect(result.truncated).toBe(false);
    cleanup();
  });

  it("检测并截断尾部未闭合的 toolCalls", () => {
    setup();
    const fp = join(testDir, "tool-test.jsonl");
    writeFileSync(fp, [
      JSON.stringify({ role: "user", content: "run cmd", timestamp: "2026-01-01T00:00:00Z" }),
      JSON.stringify({ role: "assistant", content: "", toolCalls: [{ id: "t1", name: "bash" }], timestamp: "2026-01-01T00:00:01Z" }),
      "",
    ].join("\n"));

    const result = recoverSession({
      sessionId: "tool-test",
      filePath: fp,
      now: new Date("2026-01-02"),
    });

    // 尾部 assistant 有未完成的 toolCalls，应被截断
    expect(result.truncated).toBe(true);
    expect(result.messages.length).toBe(1); // only user remained
    cleanup();
  });

  it("长时间中断后插入时间跨度提醒", () => {
    setup();
    const fp = join(testDir, "gap-test.jsonl");
    writeFileSync(fp, [
      JSON.stringify({ role: "user", content: "old msg", timestamp: "2026-01-01T00:00:00Z" }),
      JSON.stringify({ role: "assistant", content: "old reply", timestamp: "2026-01-01T00:00:01Z" }),
      "",
    ].join("\n"));

    const result = recoverSession({
      sessionId: "gap-test",
      filePath: fp,
      now: new Date("2026-01-10"),
      gapThresholdMs: 24 * 60 * 60 * 1000, // 1 day
    });

    expect(result.gapNoticeInserted).toBe(true);
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toContain("时间跨度");
    cleanup();
  });

  it("空会话文件返回空结果", () => {
    setup();
    const fp = join(testDir, "empty.jsonl");
    writeFileSync(fp, "");
    const result = recoverSession({
      sessionId: "empty",
      filePath: fp,
      now: new Date(),
    });
    expect(result.messages.length).toBe(0);
    cleanup();
  });

  it("兼容旧格式单工具结果", () => {
    setup();
    const fp = join(testDir, "old-format.jsonl");
    writeFileSync(fp, [
      JSON.stringify({ role: "user", content: "do X", timestamp: "2026-01-01T00:00:00Z" }),
      JSON.stringify({ role: "assistant", content: "", toolCalls: [{ id: "t1", name: "read" }], timestamp: "2026-01-01T00:00:01Z" }),
      JSON.stringify({ role: "user", toolResult: { content: "file content" }, toolUseId: "t1", timestamp: "2026-01-01T00:00:02Z" }),
      "",
    ].join("\n"));

    const result = recoverSession({
      sessionId: "old-format",
      filePath: fp,
      now: new Date("2026-01-02"),
    });
    // 旧格式：user + assistant(toolCalls) + user(toolResult + toolUseId) — 每个都有安全点
    expect(result.truncated).toBe(false);
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    cleanup();
  });

  it("兼容新格式同轮多工具结果", () => {
    setup();
    const fp = join(testDir, "new-format.jsonl");
    writeFileSync(fp, [
      JSON.stringify({ role: "user", content: "do A and B", timestamp: "2026-01-01T00:00:00Z" }),
      JSON.stringify({ role: "assistant", content: "", toolCalls: [{ id: "t1", name: "read" }, { id: "t2", name: "grep" }], timestamp: "2026-01-01T00:00:01Z" }),
      JSON.stringify({ role: "user", toolResults: [{ toolUseId: "t1", result: { content: "a" } }, { toolUseId: "t2", result: { content: "b" } }], timestamp: "2026-01-01T00:00:02Z" }),
      "",
    ].join("\n"));

    const result = recoverSession({
      sessionId: "new-format",
      filePath: fp,
      now: new Date("2026-01-02"),
    });
    // 新格式：user + assistant(toolCalls) + user(toolResults[]) — 闭环
    expect(result.truncated).toBe(false);
    expect(result.messages.length).toBe(3);
    cleanup();
  });
});
