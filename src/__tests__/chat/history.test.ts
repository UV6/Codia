import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { listSessions, newSessionPath, sessionPath } from "../../chat/history.js";
import {
  getLegacySessionsDir,
  getSessionsDir as getRuntimeSessionsDir,
  resolveProjectIdentity,
} from "../../storage/paths.js";
import type { Message } from "../../provider/types.js";

describe("history storage", () => {
  const baseDir = join(tmpdir(), `codia-history-test-${Date.now()}`);
  const repoRoot = join(baseDir, "repo");
  const codiaHome = join(baseDir, "user-home", ".codia");
  const previousCodiaHome = process.env.CODIA_HOME;

  beforeEach(() => {
    process.env.CODIA_HOME = codiaHome;
    mkdirSync(repoRoot, { recursive: true });
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  });

  afterEach(() => {
    if (previousCodiaHome === undefined) {
      delete process.env.CODIA_HOME;
    } else {
      process.env.CODIA_HOME = previousCodiaHome;
    }
    try { rmSync(baseDir, { recursive: true, force: true }); } catch {}
  });

  it("newSessionPath 写入用户目录下的项目 sessions", () => {
    const path = newSessionPath(new Date("2026-06-30T10:20:30Z"), repoRoot);
    const runtimeDir = getRuntimeSessionsDir(resolveProjectIdentity(repoRoot).repoRoot);

    expect(path.startsWith(runtimeDir)).toBe(true);
  });

  it("sessionPath 会把旧项目内 sessions 迁移到新目录", () => {
    const legacyDir = getLegacySessionsDir(repoRoot);
    const legacyFile = join(legacyDir, "20260630", "20260630-102030-abcd.jsonl");
    mkdirSync(dirname(legacyFile), { recursive: true });
    writeFileSync(legacyFile, JSON.stringify({
      role: "user",
      content: "hello",
      timestamp: "2026-06-30T10:20:30Z",
    } satisfies Message) + "\n", "utf-8");

    const resolved = sessionPath("20260630-102030-abcd", repoRoot);

    expect(existsSync(resolved)).toBe(true);
    expect(readFileSync(resolved, "utf-8")).toContain("hello");
    expect(resolved.startsWith(getRuntimeSessionsDir(resolveProjectIdentity(repoRoot).repoRoot))).toBe(true);
  });

  it("listSessions 能列出从旧目录迁移过来的会话", () => {
    const legacyDir = getLegacySessionsDir(repoRoot);
    const legacyFile = join(legacyDir, "20260630", "20260630-102030-abcd.jsonl");
    mkdirSync(dirname(legacyFile), { recursive: true });
    writeFileSync(legacyFile, JSON.stringify({
      role: "user",
      content: "migrated session",
      timestamp: "2026-06-30T10:20:30Z",
    } satisfies Message) + "\n", "utf-8");

    const sessions = listSessions(repoRoot);

    expect(sessions.length).toBe(1);
    expect(sessions[0].title).toContain("migrated session");
  });
});
