import {
  existsSync,
  statSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  symlinkSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative, dirname } from "node:path";
import { minimatch } from "minimatch";
import { execFileSync } from "node:child_process";
import type { WorktreeConfig, GitWorktreeOps } from "./types.js";

// WorktreeInitializer —— 工作目录创建后的环境初始化
export class WorktreeInitializer {
  private config: WorktreeConfig;
  private ops: GitWorktreeOps;

  constructor(config: WorktreeConfig, ops: GitWorktreeOps) {
    this.config = config;
    this.ops = ops;
  }

  // initialize —— 为目标工作目录准备运行环境
  async initialize(targetPath: string, repoRoot: string): Promise<void> {
    // 1. 复制配置文件
    await this.copyConfigFiles(repoRoot, targetPath);

    // 2. 复制 git hooks
    await this.copyHooks(repoRoot, targetPath);

    // 3. 软链大型依赖目录
    await this.symlinkDeps(repoRoot, targetPath);
  }

  private async copyConfigFiles(repoRoot: string, targetPath: string): Promise<void> {
    for (const pattern of this.config.copyPatterns) {
      // 递归遍历 repoRoot，匹配所有符合 pattern 的文件
      const matched = this.findFiles(repoRoot, pattern);
      for (const file of matched) {
        const relativePath = relative(repoRoot, file);
        const dest = join(targetPath, relativePath);

        // 确保目标目录存在
        mkdirSync(dirname(dest), { recursive: true });

        // 复制文件（非符号链接）
        try {
          copyFileSync(file, dest);
        } catch (e) {
          // 如果文件不可复制（如权限问题），跳过并记录
          console.warn(`[WorktreeInitializer] 无法复制文件 ${file}: ${(e as Error).message}`);
        }
      }
    }
  }

  // findFiles —— 从 root 递归查找匹配 pattern 的文件
  private findFiles(root: string, pattern: string): string[] {
    // 处理无通配的直接文件路径（如 "CLAUDE.md"）
    if (!pattern.includes("*") && !pattern.includes("?") && !pattern.includes("[")) {
      const fullPath = join(root, pattern);
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        return [fullPath];
      }
      // 可能是目录
      if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
        return this.walkDir(root, pattern, fullPath);
      }
      return [];
    }

    const results: string[] = [];

    // 提取 pattern 的基础路径（不含通配部分）
    const baseSegments: string[] = [];
    for (const seg of pattern.split("/")) {
      if (seg.includes("*") || seg.includes("?") || seg.includes("[")) break;
      baseSegments.push(seg);
    }

    const basePath = baseSegments.length > 0
      ? join(root, ...baseSegments)
      : root;

    if (!existsSync(basePath)) return results;
    if (statSync(basePath).isFile()) {
      const rel = relative(root, basePath);
      if (minimatch(rel, pattern)) {
        return [basePath];
      }
      return [];
    }

    return this.walkDir(root, pattern, basePath);
  }

  // walkDir —— 从 baseDir 递归遍历匹配符合条件的文件
  private walkDir(root: string, pattern: string, baseDir: string): string[] {
    const results: string[] = [];

    const walk = (dir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        let isDir: boolean;
        try {
          isDir = statSync(fullPath).isDirectory();
        } catch {
          continue;
        }

        const rel = relative(root, fullPath);

        if (isDir) {
          if (minimatch(rel, pattern)) {
            results.push(fullPath);
          }
          if (entry === "node_modules" || entry === ".git") continue;
          walk(fullPath);
        } else if (minimatch(rel, pattern)) {
          results.push(fullPath);
        }
      }
    };

    walk(baseDir);
    return results;
  }

  private async copyHooks(repoRoot: string, targetPath: string): Promise<void> {
    let hooksSourceDir: string | null = null;

    // 优先检查 core.hooksPath
    const hooksPath = await this.ops.getHooksPath(repoRoot);
    if (hooksPath) {
      const resolved = join(repoRoot, hooksPath);
      if (existsSync(resolved)) {
        hooksSourceDir = resolved;
        console.log(`[WorktreeInitializer] 使用 core.hooksPath: ${resolved}`);
      }
    }

    // 回退到 <gitdir>/hooks/
    if (!hooksSourceDir) {
      try {
        const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
          cwd: repoRoot,
          encoding: "utf-8",
        }).trim();
        const hooksDir = join(repoRoot, gitDir, "hooks");
        if (existsSync(hooksDir)) {
          hooksSourceDir = hooksDir;
        }
      } catch {
        // git rev-parse 失败，跳过 hooks 复制
      }
    }

    if (hooksSourceDir && hooksSourceDir !== join(repoRoot, ".git", "hooks")) {
      // 目标 gitdir hooks 目录
      let targetGitDir: string;
      try {
        targetGitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
          cwd: targetPath,
          encoding: "utf-8",
        }).trim();
      } catch {
        // 无法获取目标 gitdir，跳过
        return;
      }

      const targetHooksDir = join(targetPath, targetGitDir, "hooks");
      mkdirSync(targetHooksDir, { recursive: true });

      // 复制 hooks 文件
      try {
        const entries = readdirSync(hooksSourceDir);
        for (const entry of entries) {
          const src = join(hooksSourceDir, entry);
          const dest = join(targetHooksDir, entry);
          try {
            if (statSync(src).isFile()) {
              copyFileSync(src, dest);
              // 保持可执行权限（通过读取+写入来保持内容，chmod 在 macOS 上有限制）
            }
          } catch {
            // 跳过个别文件复制失败
          }
        }
        console.log(`[WorktreeInitializer] hooks 目录已复制: ${targetHooksDir}`);
      } catch {
        console.warn("[WorktreeInitializer] hooks 复制失败，跳过");
      }
    }
  }

  private async symlinkDeps(repoRoot: string, targetPath: string): Promise<void> {
    for (const dir of this.config.symlinkDirs) {
      const src = join(repoRoot, dir);
      const dest = join(targetPath, dir);

      if (!existsSync(src)) continue;
      if (existsSync(dest)) continue; // 已存在则跳过

      try {
        symlinkSync(src, dest, "dir");
        console.log(`[WorktreeInitializer] 软链接已创建: ${dest} → ${src}`);
      } catch {
        // symlink 失败，回退到复制
        console.warn(`[WorktreeInitializer] 软链接失败，回退到复制：${dir}`);
        try {
          this.copyDirRecursive(src, dest);
        } catch (e) {
          console.warn(`[WorktreeInitializer] 复制也失败：${dir}: ${(e as Error).message}`);
        }
      }
    }
  }

  // copyDirRecursive —— 递归复制目录（symlink 失败时的回退方案）
  private copyDirRecursive(src: string, dest: string): void {
    mkdirSync(dest, { recursive: true });
    const entries = readdirSync(src);
    for (const entry of entries) {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      const st = statSync(srcPath);
      if (st.isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else if (st.isSymbolicLink()) {
        // 复制符号链接而非目标
        try {
          symlinkSync(statsToLinkTarget(srcPath), destPath);
        } catch {
          copyFileSync(srcPath, destPath);
        }
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  }
}

// statsToLinkTarget —— 读取符号链接的目标路径
function statsToLinkTarget(symlinkPath: string): string {
  // readlinkSync 需要特殊的 fs API
  const { readlinkSync } = require("node:fs") as typeof import("node:fs");
  return readlinkSync(symlinkPath);
}
