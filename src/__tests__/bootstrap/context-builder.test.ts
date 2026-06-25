import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { buildNewSessionContext, buildResumeContext } from "../../bootstrap/context-builder.js";

describe("context-builder", () => {
  const projectRoot = join(tmpdir(), "codia-bootstrap-test");

  function cleanup() {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch {}
  }
  function setup() {
    cleanup();
    mkdirSync(projectRoot, { recursive: true });
  }

  it("新会话上下文包含指令文本（如果存在 Codia.md）", () => {
    setup();
    writeFileSync(join(projectRoot, "Codia.md"), "# Project Rules\nUse TypeScript.");
    const ctx = buildNewSessionContext({ projectRoot, now: new Date() });
    expect(ctx.instructionText).toContain("Project Rules");
    expect(ctx.recoveredMessages.length).toBe(0);
    cleanup();
  });

  it("新会话在主模块不可用时仍返回降级上下文", () => {
    setup();
    // 不创建任何文件 — 降级
    const ctx = buildNewSessionContext({
      projectRoot: join(tmpdir(), "nonexistent-dir"),
      now: new Date(),
    });
    expect(ctx.instructionText).toBe("");
    expect(ctx.diagnostics).toBeDefined();
    cleanup();
  });

  it("恢复已损坏会话时返回降级上下文", () => {
    setup();
    const sessionsDir = join(projectRoot, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    // 写一个坏行 JSONL
    writeFileSync(join(sessionsDir, "test-bad.jsonl"), "garbage\n");

    const ctx = buildResumeContext(
      { projectRoot, now: new Date() },
      "test-bad",
    );
    // 恢复应该不崩溃
    expect(ctx.diagnostics).toBeDefined();
    cleanup();
  });
});
