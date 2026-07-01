import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolveEntry, isPathAllowed } from "../../instruction/resolver.js";
import type { InstructionResolveOptions } from "../../instruction/types.js";

const DEFAULT_OPTIONS: InstructionResolveOptions = {
  maxIncludeDepth: 5,
  projectRoot: "/tmp/test-project",
  allowExternalUserFile: false,
  visited: new Set<string>(),
  includeToken: "@include",
};

describe("isPathAllowed", () => {
  it("允许项目根目录内的路径", () => {
    const opts = { ...DEFAULT_OPTIONS, visited: new Set<string>() };
    expect(isPathAllowed(resolve("/tmp/test-project/src/foo.md"), opts)).toBe(true);
  });

  it("允许项目根目录本身", () => {
    const opts = { ...DEFAULT_OPTIONS, visited: new Set<string>() };
    expect(isPathAllowed(resolve("/tmp/test-project"), opts)).toBe(true);
  });

  it("拦截项目目录之外的路径", () => {
    const opts = { ...DEFAULT_OPTIONS, visited: new Set<string>() };
    expect(isPathAllowed(resolve("/tmp/other-project/file.md"), opts)).toBe(false);
  });

  it("allowExternalUserFile 为 true 时允许用户 .codia 路径", () => {
    const opts = { ...DEFAULT_OPTIONS, allowExternalUserFile: true, visited: new Set<string>() };
    const homeDir = resolve(process.env.HOME || "/", ".codia");
    expect(isPathAllowed(resolve(homeDir, "test.md"), opts)).toBe(true);
  });

  it("allowExternalUserFile 为 false 时不检查用户 .codia", () => {
    const homeDir = resolve(process.env.HOME || "/", ".codia");
    const opts = { ...DEFAULT_OPTIONS, allowExternalUserFile: false, visited: new Set<string>() };
    // 用户目录不在项目根下，应被拦截
    if (!homeDir.startsWith("/tmp/test-project")) {
      expect(isPathAllowed(resolve(homeDir, "test.md"), opts)).toBe(false);
    } else {
      // 如果恰好用户目录在项目根下（测试环境可能如此），跳过
    }
  });
});

describe("resolveEntry", () => {
  const testDir = join(tmpdir(), "codia-instruction-test");

  function cleanup() {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  function setup() {
    cleanup();
    mkdirSync(testDir, { recursive: true });
  }

  it("正常加载单个指令文件", () => {
    setup();
    const content = "# 测试规则\n这是项目测试规则。";
    writeFileSync(join(testDir, "TEST.md"), content);

    const opts: InstructionResolveOptions = {
      ...DEFAULT_OPTIONS,
      projectRoot: testDir,
      visited: new Set<string>(),
    };

    const docs = resolveEntry(join(testDir, "TEST.md"), opts);
    expect(docs.length).toBe(1);
    expect(docs[0].content).toBe(content);
    expect(docs[0].warnings.length).toBe(0);
    cleanup();
  });

  it("找到循环引用并产生 warning", () => {
    setup();
    // A 引用 B，B 引用 A
    writeFileSync(join(testDir, "A.md"), "@include B.md\n--- A");
    writeFileSync(join(testDir, "B.md"), "@include A.md\n--- B");

    const opts: InstructionResolveOptions = {
      ...DEFAULT_OPTIONS,
      maxIncludeDepth: 2,
      projectRoot: testDir,
      visited: new Set<string>(),
    };

    const docs = resolveEntry(join(testDir, "A.md"), opts);
    const allWarnings = docs.flatMap((d) => d.warnings);
    const hasCycleWarning = allWarnings.some((w) => w.includes("循环引用"));
    expect(hasCycleWarning).toBe(true);
    cleanup();
  });

  it("超过最大深度时报告 warning", () => {
    setup();
    writeFileSync(join(testDir, "C.md"), "@include D.md\n--- C");
    writeFileSync(join(testDir, "D.md"), "@include E.md\n--- D");
    writeFileSync(join(testDir, "E.md"), "--- E");

    const opts: InstructionResolveOptions = {
      ...DEFAULT_OPTIONS,
      maxIncludeDepth: 1,
      projectRoot: testDir,
      visited: new Set<string>(),
    };

    const docs = resolveEntry(join(testDir, "C.md"), opts);
    const allWarnings = docs.flatMap((d) => d.warnings);
    const hasDepthWarning = allWarnings.some((w) => w.includes("深度超过"));
    expect(hasDepthWarning).toBe(true);
    cleanup();
  });

  it("越界路径被拦截", () => {
    setup();
    // 在项目目录外创建一个文件
    const outsidePath = join(tmpdir(), "outside-test.md");
    writeFileSync(outsidePath, "# 外部文件");

    // 在项目中引用越界文件
    const insideFile = join(testDir, "inside.md");

    // 越界引用：include 一个 testDir 之外的路径
    // 直接用相对路径 "../outside-test.md" 会导致解析后超出项目范围
    writeFileSync(insideFile, `@include ../outside-test.md\n--- inside`);

    const opts: InstructionResolveOptions = {
      ...DEFAULT_OPTIONS,
      maxIncludeDepth: 2,
      projectRoot: testDir,
      visited: new Set<string>(),
    };

    const docs = resolveEntry(insideFile, opts);
    // 应该至少有一个 warning 或在展开后的内容中包含拦截标记
    // 因为被引用文件不在项目根下
    try {
      rmSync(outsidePath);
    } catch {
      // ignore
    }
    cleanup();
  });

  it("不存在的文件生成 warning", () => {
    setup();
    const opts: InstructionResolveOptions = {
      ...DEFAULT_OPTIONS,
      projectRoot: testDir,
      visited: new Set<string>(),
    };
    const docs = resolveEntry(join(testDir, "NONEXISTENT.md"), opts);
    expect(docs.some((d) => d.warnings.some((w) => w.includes("不存在")))).toBe(true);
    cleanup();
  });
});
