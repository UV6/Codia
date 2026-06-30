import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  getLegacyProjectMemoryDir,
  getLegacySessionsDir,
  getProjectMemoryDir,
  getSessionsDir,
  migrateDirectoryContents,
  resolveProjectIdentity,
} from "../../storage/paths.js";

describe("storage paths", () => {
  const baseDir = join(tmpdir(), `codia-storage-test-${Date.now()}`);
  const repoRoot = join(baseDir, "repo");
  const subDir = join(repoRoot, "src");
  const codiaHome = join(baseDir, "user-home", ".codia");
  const previousCodiaHome = process.env.CODIA_HOME;

  beforeEach(() => {
    process.env.CODIA_HOME = codiaHome;
    mkdirSync(subDir, { recursive: true });
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

  it("同一仓库根和子目录得到相同 projectId", () => {
    const rootIdentity = resolveProjectIdentity(repoRoot);
    const subIdentity = resolveProjectIdentity(subDir);

    expect(rootIdentity.repoRoot).toBe(subIdentity.repoRoot);
    expect(rootIdentity.projectId).toBe(subIdentity.projectId);
  });

  it("migrateDirectoryContents 将旧 sessions 搬到新目录", () => {
    const legacyDir = getLegacySessionsDir(repoRoot);
    const targetDir = getSessionsDir(repoRoot);
    mkdirSync(join(legacyDir, "20260630"), { recursive: true });
    writeFileSync(join(legacyDir, "20260630", "test.jsonl"), "{\"role\":\"user\"}\n", "utf-8");

    migrateDirectoryContents(legacyDir, targetDir);

    expect(existsSync(join(targetDir, "20260630", "test.jsonl"))).toBe(true);
    expect(readFileSync(join(targetDir, "20260630", "test.jsonl"), "utf-8")).toContain("\"user\"");
    expect(existsSync(legacyDir)).toBe(false);
  });

  it("migrateDirectoryContents 将旧 project memory 搬到新目录", () => {
    const legacyDir = getLegacyProjectMemoryDir(repoRoot);
    const targetDir = getProjectMemoryDir(repoRoot);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "MEMORY.md"), "# index", "utf-8");

    migrateDirectoryContents(legacyDir, targetDir);

    expect(existsSync(join(targetDir, "MEMORY.md"))).toBe(true);
    expect(readFileSync(join(targetDir, "MEMORY.md"), "utf-8")).toContain("# index");
    expect(existsSync(legacyDir)).toBe(false);
  });
});
