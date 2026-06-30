import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import {
  getMemoryDir,
  loadIndexes,
  upsertNote,
  readIndex,
  writeIndex,
  renderIndexText,
} from "../../memory/store.js";
import type { MemoryNote, MemoryIndexBundle } from "../../memory/types.js";
import {
  getLegacyProjectMemoryDir,
  getProjectMemoryDir,
  resolveProjectIdentity,
} from "../../storage/paths.js";

describe("memory store", () => {
  const projectRoot = join(tmpdir(), "codia-memory-test");
  const codiaHome = join(tmpdir(), "codia-memory-home", ".codia");
  const previousCodiaHome = process.env.CODIA_HOME;

  function cleanup() {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch {}
    try { rmSync(join(tmpdir(), "codia-memory-home"), { recursive: true, force: true }); } catch {}
  }
  function setup() {
    process.env.CODIA_HOME = codiaHome;
    cleanup();
    mkdirSync(projectRoot, { recursive: true });
  }

  function makeNote(id: string, overrides: Partial<MemoryNote> = {}): MemoryNote {
    return {
      id,
      scope: "project",
      category: "project_knowledge",
      title: `Test Note ${id}`,
      summary: `Summary for ${id}`,
      body: `Full body for ${id}`,
      sourceSessionId: "20260618-120000-aaaa",
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  afterEach(() => {
    if (previousCodiaHome === undefined) {
      delete process.env.CODIA_HOME;
    } else {
      process.env.CODIA_HOME = previousCodiaHome;
    }
  });

  it("添加笔记后可通过 readIndex 读取", () => {
    setup();
    const note = makeNote("test-1");
    upsertNote(note, projectRoot);
    const entries = readIndex("project", projectRoot);
    expect(entries.some((e) => e.noteId === "test-1")).toBe(true);
    cleanup();
  });

  it("更新已有笔记不会产生重复条目", () => {
    setup();
    const note = makeNote("test-2", { summary: "original" });
    upsertNote(note, projectRoot);
    const updated = makeNote("test-2", { summary: "updated" });
    upsertNote(updated, projectRoot);

    const entries = readIndex("project", projectRoot);
    const matching = entries.filter((e) => e.noteId === "test-2");
    expect(matching.length).toBe(1);
    expect(matching[0].summary).toBe("updated");
    cleanup();
  });

  it("索引裁剪限制行数", () => {
    setup();
    const entries = Array.from({ length: 250 }, (_, i) => ({
      noteId: `bulk-${i}`,
      category: "project_knowledge" as const,
      summary: `Summary for item ${i}`,
      updatedAt: "",
      path: `bulk-${i}.md`,
    }));
    writeIndex("project", projectRoot, entries);
    const loaded = readIndex("project", projectRoot);
    expect(loaded.length).toBeLessThanOrEqual(200);
    cleanup();
  });

  it("renderIndexText 合并 project 和 user 索引", () => {
    const bundle: MemoryIndexBundle = {
      project: [
        { noteId: "p1", category: "project_knowledge", summary: "项目知识1", updatedAt: "", path: "p1.md" },
      ],
      user: [
        { noteId: "u1", category: "user_preference", summary: "用户偏好1", updatedAt: "", path: "u1.md" },
      ],
    };
    const text = renderIndexText(bundle);
    expect(text).toContain("项目记忆");
    expect(text).toContain("用户记忆");
    expect(text).toContain("项目知识1");
    expect(text).toContain("用户偏好1");
  });

  it("loadIndexes 返回双 scope 索引", () => {
    setup();
    const note = makeNote("test-scope");
    upsertNote(note, projectRoot);
    const bundle = loadIndexes(projectRoot);
    expect(bundle.project).toBeDefined();
    expect(bundle.user).toBeDefined();
    cleanup();
  });

  it("项目级记忆写入用户目录下的项目 runtime 目录", () => {
    setup();
    const note = makeNote("runtime-path");
    upsertNote(note, projectRoot);

    const dir = getMemoryDir("project", projectRoot);
    const runtimeDir = getProjectMemoryDir(resolveProjectIdentity(projectRoot).repoRoot);
    expect(dir).toBe(runtimeDir);
    expect(existsSync(join(runtimeDir, "runtime-path.md"))).toBe(true);
    cleanup();
  });

  it("读取项目记忆时会迁移旧的 projectRoot/memory", () => {
    setup();
    const legacyDir = getLegacyProjectMemoryDir(projectRoot);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "MEMORY.md"), "# Memory Index\n\n- [project_knowledge] old summary (old-note)\n", "utf-8");

    const entries = readIndex("project", projectRoot);

    expect(entries.length).toBe(1);
    expect(existsSync(join(getProjectMemoryDir(resolveProjectIdentity(projectRoot).repoRoot), "MEMORY.md"))).toBe(true);
    cleanup();
  });
});
