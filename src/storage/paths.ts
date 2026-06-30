import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

export interface ProjectIdentity {
  cwd: string;
  repoRoot: string;
  gitCommonDir: string;
  projectId: string;
}

function tryRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function runGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function getUserCodiaRoot(): string {
  return process.env.CODIA_HOME
    ? resolve(process.env.CODIA_HOME)
    : join(homedir(), ".codia");
}

export function getProjectsRoot(): string {
  return join(getUserCodiaRoot(), "projects");
}

export function resolveProjectIdentity(cwd: string = process.cwd()): ProjectIdentity {
  const resolvedCwd = tryRealpath(cwd);
  const gitTopLevel = runGit(resolvedCwd, ["rev-parse", "--show-toplevel"]);
  const repoRoot = gitTopLevel ? tryRealpath(gitTopLevel) : resolvedCwd;

  const gitCommonDirRaw = runGit(resolvedCwd, ["rev-parse", "--git-common-dir"]);
  const gitCommonDir = gitCommonDirRaw
    ? tryRealpath(resolve(resolvedCwd, gitCommonDirRaw))
    : repoRoot;

  const projectId = createHash("sha1")
    .update(gitCommonDir)
    .digest("hex")
    .slice(0, 12);

  return {
    cwd: resolvedCwd,
    repoRoot,
    gitCommonDir,
    projectId,
  };
}

export function getProjectRuntimeRoot(projectRoot: string): string {
  return join(getProjectsRoot(), resolveProjectIdentity(projectRoot).projectId);
}

export function getSessionsDir(projectRoot: string): string {
  return join(getProjectRuntimeRoot(projectRoot), "sessions");
}

export function getProjectMemoryDir(projectRoot: string): string {
  return join(getProjectRuntimeRoot(projectRoot), "memory");
}

export function getUserMemoryDir(): string {
  return join(getUserCodiaRoot(), "memory");
}

export function getWorktreesDir(projectRoot: string): string {
  return join(getProjectRuntimeRoot(projectRoot), "worktrees");
}

export function getTeamsRoot(): string {
  return join(getUserCodiaRoot(), "teams");
}

export function getLegacySessionsDir(projectRoot: string): string {
  return resolve(projectRoot, "sessions");
}

export function getLegacyProjectMemoryDir(projectRoot: string): string {
  return resolve(projectRoot, "memory");
}

export function getLegacyWorktreesDir(projectRoot: string): string {
  return resolve(projectRoot, ".codia", "worktrees");
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function buildConflictPath(targetFile: string): string {
  const dir = dirname(targetFile);
  const base = targetFile.replace(/\.[^.]+$/, "");
  const ext = targetFile.slice(base.length);
  let i = 1;
  let next = `${base}.legacy-${i}${ext}`;
  while (existsSync(next)) {
    i++;
    next = `${base}.legacy-${i}${ext}`;
  }
  return next;
}

function removeEmptyDirs(dir: string, stopAt: string): void {
  let current = dir;
  const boundary = resolve(stopAt);
  while (current.startsWith(boundary)) {
    try {
      if (readdirSync(current).length > 0) {
        return;
      }
      rmSync(current, { recursive: false, force: true });
    } catch {
      return;
    }
    if (current === boundary) {
      return;
    }
    current = dirname(current);
  }
}

function moveFileWithMerge(sourceFile: string, targetFile: string): void {
  ensureDir(dirname(targetFile));
  if (!existsSync(targetFile)) {
    renameSync(sourceFile, targetFile);
    return;
  }

  const sourceRaw = readFileSync(sourceFile, "utf-8");
  const targetRaw = readFileSync(targetFile, "utf-8");
  if (sourceRaw === targetRaw) {
    unlinkSync(sourceFile);
    return;
  }

  writeFileSync(buildConflictPath(targetFile), sourceRaw, "utf-8");
  unlinkSync(sourceFile);
}

function collectFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export function migrateDirectoryContents(sourceDir: string, targetDir: string): void {
  const source = resolve(sourceDir);
  const target = resolve(targetDir);
  if (source === target || !existsSync(source)) {
    return;
  }

  ensureDir(dirname(target));
  if (!existsSync(target)) {
    renameSync(source, target);
    return;
  }

  for (const sourceFile of collectFiles(source)) {
    const rel = relative(source, sourceFile);
    moveFileWithMerge(sourceFile, join(target, rel));
    removeEmptyDirs(dirname(sourceFile), source);
  }

  try {
    if (existsSync(source) && readdirSync(source).length === 0) {
      rmSync(source, { recursive: false, force: true });
    }
  } catch {
    // ignore
  }
}

export function directoryHasEntries(dir: string): boolean {
  if (!existsSync(dir)) {
    return false;
  }
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

export function statMtimeOrNull(path: string): Date | null {
  try {
    return statSync(path).mtime;
  } catch {
    return null;
  }
}
