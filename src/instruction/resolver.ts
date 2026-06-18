import {
  readFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { resolve, dirname, relative } from "node:path";
import type {
  ResolvedInstructionDocument,
  InstructionResolveOptions,
} from "./types.js";

const INCLUDE_REGEX = /@include\s+(\S+)/g;

// resolveEntry —— 解析一个入口文件，递归展开 @include
export function resolveEntry(
  entryPath: string,
  options: InstructionResolveOptions,
): ResolvedInstructionDocument[] {
  const resolved = resolve(options.projectRoot, entryPath);
  return resolveFile(resolved, options, 0);
}

// resolveInclude —— 展开 @include 引用
export function resolveInclude(
  currentFile: string,
  includeTarget: string,
  options: InstructionResolveOptions,
  parentDepth: number,
): ResolvedInstructionDocument[] {
  const baseDir = dirname(currentFile);
  const resolved = resolve(baseDir, includeTarget);
  return resolveFile(resolved, options, parentDepth + 1);
}

function resolveFile(
  absolutePath: string,
  options: InstructionResolveOptions,
  depth: number,
): ResolvedInstructionDocument[] {
  const results: ResolvedInstructionDocument[] = [];

  // 深度限制
  if (depth > options.maxIncludeDepth) {
    return [
      {
        sourcePath: absolutePath,
        displayPath: relative(options.projectRoot, absolutePath),
        content: "",
        depth,
        warnings: [`include 深度超过上限（${options.maxIncludeDepth}），跳过：${absolutePath}`],
      },
    ];
  }

  // 防环路
  const canonical = statSync(absolutePath, { throwIfNoEntry: false })?.ino
    ? absolutePath
    : absolutePath;
  if (options.visited.has(canonical)) {
    return [
      {
        sourcePath: absolutePath,
        displayPath: relative(options.projectRoot, absolutePath),
        content: "",
        depth,
        warnings: [`循环引用，已跳过：${absolutePath}`],
      },
    ];
  }
  options.visited.add(canonical);

  // 边界检查
  if (!isPathAllowed(absolutePath, options)) {
    return [
      {
        sourcePath: absolutePath,
        displayPath: relative(options.projectRoot, absolutePath),
        content: "",
        depth,
        warnings: [
          `越界引用，已拦截：${absolutePath}（不允许访问项目目录或 mewcode 子树之外的路径）`,
        ],
      },
    ];
  }

  // 文件不存在
  if (!existsSync(absolutePath)) {
    return [
      {
        sourcePath: absolutePath,
        displayPath: relative(options.projectRoot, absolutePath),
        content: "",
        depth,
        warnings: [`指令文件不存在：${absolutePath}`],
      },
    ];
  }

  const content = readFileSync(absolutePath, "utf-8");
  const warnings: string[] = [];

  // 扫描 @include
  const includes = extractIncludes(content);
  let expanded = content;

  for (const inc of includes) {
    const childResults = resolveInclude(absolutePath, inc, {
      ...options,
      maxIncludeDepth: options.maxIncludeDepth,
    }, depth);
    for (const child of childResults) {
      results.push(child);
      // 把被 include 的内容插入当前文档的 @include 位置
      expanded = expanded.replace(
        new RegExp(`@include\\s+${escapeRegExp(inc)}`, "g"),
        child.content || `[${child.warnings[0] || "include 展开失败"}]`,
      );
    }
  }

  const doc: ResolvedInstructionDocument = {
    sourcePath: absolutePath,
    displayPath: relative(options.projectRoot, absolutePath),
    content: expanded,
    depth,
    includedFrom: undefined,
    warnings,
  };

  // 传播子文档的 warnings
  for (const child of results) {
    for (const w of child.warnings) {
      if (!doc.warnings.includes(w)) {
        doc.warnings.push(`${child.displayPath}: ${w}`);
      }
    }
  }

  return [{ ...doc }, ...results.filter((r) => r.sourcePath !== absolutePath)];
}

// isPathAllowed —— 检查目标路径是否在允许范围内
export function isPathAllowed(
  targetPath: string,
  options: InstructionResolveOptions,
): boolean {
  const projectRoot = resolve(options.projectRoot);
  const mewcodeDir = resolve(projectRoot, ".mewcode");
  const userMewcode = resolve(
    process.env.HOME || "/",
    ".mewcode",
  );

  // 允许项目根目录及其子目录
  if (targetPath.startsWith(projectRoot + "/") || targetPath === projectRoot) {
    return true;
  }

  // 允许用户 .mewcode 目录（仅在显式允许时）
  if (options.allowExternalUserFile) {
    if (targetPath.startsWith(userMewcode + "/") || targetPath === userMewcode) {
      return true;
    }
  }

  // 不在允许范围内
  return false;
}

function extractIncludes(content: string): string[] {
  const matches: string[] = [];
  for (const m of content.matchAll(INCLUDE_REGEX)) {
    matches.push(m[1]);
  }
  return matches;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
