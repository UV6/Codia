import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import {
  loadIndexes,
  upsertNote,
  readIndex,
  writeIndex,
  renderIndexText,
} from "../../memory/store.js";
import type { MemoryNote, MemoryIndexEntry, MemoryIndexBundle } from "../../memory/types.js";

describe("memory store", () => {
  const projectRoot = join(tmpdir(), "codia-memory-test");

  function cleanup() {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch {}
  }
  function setup() {
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
    // 写入超过 MAX 的条目
    for (let i = 0; i < 250; i++) {
      const note = makeNote(`bulk-${i}`, {
        summary: `Summary for item ${i}`,
      });
      upsertNote(note, projectRoot);
    }
    const entries = readIndex("project", projectRoot);
    expect(entries.length).toBeLessThanOrEqual(200);
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
});
