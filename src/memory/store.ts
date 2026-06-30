import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join, basename } from "node:path";
import type { MemoryNote, MemoryIndexEntry, MemoryIndexBundle, MemoryScope } from "./types.js";
import {
  getLegacyProjectMemoryDir,
  getProjectMemoryDir,
  getUserMemoryDir,
  migrateDirectoryContents,
  resolveProjectIdentity,
} from "../storage/paths.js";

const NOTE_EXT = ".md";
const INDEX_FILENAME = "MEMORY.md";
const MAX_INDEX_LINES = 200;
const MAX_INDEX_BYTES = 25_000;

// getMemoryDir —— 获取用户级或项目级 memory 目录
export function getMemoryDir(scope: MemoryScope, projectRoot: string): string {
  if (scope === "user") {
    return getUserMemoryDir();
  }
  const repoRoot = resolveProjectIdentity(projectRoot).repoRoot;
  return getProjectMemoryDir(repoRoot);
}

function ensureMemoryMigrated(scope: MemoryScope, projectRoot: string): string {
  const dir = getMemoryDir(scope, projectRoot);
  if (scope === "project") {
    const repoRoot = resolveProjectIdentity(projectRoot).repoRoot;
    const legacyDir = getLegacyProjectMemoryDir(repoRoot);
    if (existsSync(legacyDir) && legacyDir !== dir) {
      migrateDirectoryContents(legacyDir, dir);
    }
  }
  ensureDir(dir);
  return dir;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// loadIndexes —— 加载用户级和项目级记忆索引
export function loadIndexes(projectRoot: string): MemoryIndexBundle {
  return {
    project: readIndex("project", projectRoot),
    user: readIndex("user", projectRoot),
  };
}

// readIndex —— 读取单个 scope 的索引文件
export function readIndex(scope: MemoryScope, projectRoot: string): MemoryIndexEntry[] {
  const dir = ensureMemoryMigrated(scope, projectRoot);
  const indexPath = join(dir, INDEX_FILENAME);
  if (!existsSync(indexPath)) return [];
  try {
    const content = readFileSync(indexPath, "utf-8");
    return parseIndexContent(content);
  } catch {
    return [];
  }
}

// writeIndex —— 写入索引文件
export function writeIndex(
  scope: MemoryScope,
  projectRoot: string,
  entries: MemoryIndexEntry[],
): void {
  const dir = ensureMemoryMigrated(scope, projectRoot);
  const indexPath = join(dir, INDEX_FILENAME);

  // 裁剪
  let trimmed = entries;
  if (trimmed.length > MAX_INDEX_LINES) {
    trimmed = entries.slice(0, MAX_INDEX_LINES);
  }
  const content = renderIndex(trimmed);
  if (Buffer.byteLength(content, "utf-8") > MAX_INDEX_BYTES) {
    // 缩小直到不超过上限
    while (trimmed.length > 0 && Buffer.byteLength(renderIndex(trimmed), "utf-8") > MAX_INDEX_BYTES) {
      trimmed = trimmed.slice(0, -1);
    }
  }
  writeFileSync(indexPath, renderIndex(trimmed), "utf-8");
}

// upsertNote —— 新增或更新单条笔记，同时更新索引
export function upsertNote(
  note: MemoryNote,
  projectRoot: string,
): void {
  const dir = ensureMemoryMigrated(note.scope, projectRoot);

  // 笔记文件以 id.md 存储
  const notePath = join(dir, `${note.id}${NOTE_EXT}`);
  writeFileSync(notePath, renderNote(note), "utf-8");

  // 更新索引
  const entries = readIndex(note.scope, projectRoot);
  const idx = entries.findIndex((e) => e.noteId === note.id);
  const entry: MemoryIndexEntry = {
    noteId: note.id,
    category: note.category,
    summary: note.summary,
    updatedAt: note.updatedAt,
    path: notePath,
  };
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.unshift(entry);
  }
  writeIndex(note.scope, projectRoot, entries);
}

// listNotes —— 列出某个 scope 的所有笔记
export function listNotes(scope: MemoryScope, projectRoot: string): MemoryNote[] {
  const dir = ensureMemoryMigrated(scope, projectRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(NOTE_EXT))
    .map((f) => {
      try {
        return parseNote(readFileSync(join(dir, f), "utf-8"));
      } catch {
        return null;
      }
    })
    .filter((n): n is MemoryNote => n !== null);
}

// deleteNote —— 删除单条笔记
export function deleteNote(noteId: string, scope: MemoryScope, projectRoot: string): void {
  const dir = ensureMemoryMigrated(scope, projectRoot);
  const notePath = join(dir, `${noteId}${NOTE_EXT}`);
  if (existsSync(notePath)) unlinkSync(notePath);
  // 重建索引
  const entries = readIndex(scope, projectRoot).filter((e) => e.noteId !== noteId);
  writeIndex(scope, projectRoot, entries);
}

// renderIndexText —— 将索引包渲染为注入文本
export function renderIndexText(bundle: MemoryIndexBundle): string {
  const lines: string[] = [];
  if (bundle.project.length > 0) {
    lines.push("## 项目记忆");
    for (const e of bundle.project) {
      lines.push(`- [${e.category}] ${e.summary}`);
    }
  }
  if (bundle.user.length > 0) {
    lines.push("## 用户记忆");
    for (const e of bundle.user) {
      lines.push(`- [${e.category}] ${e.summary}`);
    }
  }
  return lines.join("\n");
}

function parseIndexContent(content: string): MemoryIndexEntry[] {
  const entries: MemoryIndexEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // 格式: - [category] summary (noteId)
    const catMatch = trimmed.match(/^-\s*\[(\w+)\]\s+(.*)$/);
    if (!catMatch) continue;
    const category = catMatch[1] as MemoryIndexEntry["category"];
    const rest = catMatch[2];
    // 提取末尾的 (noteId)
    const pathMatch = rest.match(/^(.*)\s+\(([^)]+)\)$/);
    if (pathMatch) {
      entries.push({
        noteId: pathMatch[2],
        category,
        summary: pathMatch[1],
        updatedAt: "",
        path: pathMatch[2],
      });
    } else {
      entries.push({
        noteId: rest,
        category,
        summary: rest,
        updatedAt: "",
        path: rest,
      });
    }
  }
  return entries;
}

function renderIndex(entries: MemoryIndexEntry[]): string {
  const lines = ["# Memory Index", ""];
  for (const e of entries) {
    lines.push(`- [${e.category}] ${e.summary} (${e.noteId})`);
  }
  return lines.join("\n");
}

function renderNote(note: MemoryNote): string {
  return [
    "---",
    `id: ${note.id}`,
    `scope: ${note.scope}`,
    `category: ${note.category}`,
    `source_session: ${note.sourceSessionId}`,
    `updated_at: ${note.updatedAt}`,
    note.tags ? `tags: ${note.tags.join(",")}` : "",
    "---",
    "",
    `# ${note.title}`,
    "",
    note.body,
  ].join("\n");
}

function parseNote(content: string): MemoryNote | null {
  const parts = content.split("---\n");
  if (parts.length < 3) return null;
  const frontmatter = parts[1];
  const body = parts.slice(2).join("---\n").trim();
  const fm: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const colon = line.indexOf(":");
    if (colon >= 0) {
      fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
  }
  return {
    id: fm.id ?? "",
    scope: (fm.scope ?? "project") as MemoryNote["scope"],
    category: (fm.category ?? "project_knowledge") as MemoryNote["category"],
    title: content.match(/^# (.+)$/m)?.[1] ?? "",
    summary: fm.title ?? "",
    body,
    sourceSessionId: fm.source_session ?? "",
    updatedAt: fm.updated_at ?? "",
  };
}
