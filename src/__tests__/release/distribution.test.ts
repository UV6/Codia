import { existsSync, readFileSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("distribution packaging", () => {
  it("package.json 暴露编译后的 CLI 入口和发布脚本", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as {
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
      files?: string[];
      engines?: { node?: string };
    };

    expect(pkg.bin?.codia).toBe("./dist/bin/codia.js");
    expect(pkg.scripts?.build).toBe("node ./scripts/build-package.mjs");
    expect(pkg.scripts?.prepack).toBe("pnpm typecheck && pnpm test && pnpm build");
    expect(pkg.files).toEqual(expect.arrayContaining(["dist", "README.md", "LICENSE"]));
    expect(pkg.engines?.node).toBeTruthy();
  });

  it("CLI 源入口使用 node shebang，便于编译后直接执行", () => {
    const source = readFileSync("bin/codia.tsx", "utf-8");
    expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("存在发布构建脚本和专用 tsconfig", () => {
    expect(existsSync("scripts/build-package.mjs")).toBe(true);
    expect(existsSync("tsconfig.build.json")).toBe(true);
  });

  it("构建辅助脚本会把内置 Skill 复制到 dist 产物目录", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "codia-release-test-"));
    const distDir = join(workspace, "dist");
    const sourceDir = join(workspace, "src", "skill", "builtin");

    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "commit.md"), "---\nname: commit\ndescription: test\nmode: inline\n---\n");
    mkdirSync(distDir, { recursive: true });

    const mod = await import("../../../scripts/build-package.mjs");
    mod.copyRuntimeAssets(workspace);

    expect(
      existsSync(join(workspace, "dist", "src", "skill", "builtin", "commit.md")),
    ).toBe(true);

    rmSync(workspace, { recursive: true, force: true });
  });
});
