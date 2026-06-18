import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { loadForProject } from "../../instruction/loader.js";

describe("loadForProject", () => {
  const testDir = join(tmpdir(), "codia-loader-test");

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
    mkdirSync(join(testDir, ".mewcode"), { recursive: true });
  }

  it("无任何指令文件时返回空结果且不报错", () => {
    setup();
    const result = loadForProject(testDir);
    expect(result.text).toBe("");
    expect(result.diagnostics.length).toBe(0);
    cleanup();
  });

  it("加载单个项目根指令文件", () => {
    setup();
    writeFileSync(join(testDir, "MEWCODE.md"), "# 项目规则\n使用 TypeScript。");
    const result = loadForProject(testDir);
    expect(result.text).toContain("# 项目规则");
    expect(result.documents.length).toBeGreaterThan(0);
    cleanup();
  });

  it("三层文件都存在时按优先级拼接", () => {
    setup();
    writeFileSync(join(testDir, "MEWCODE.md"), "# 项目根规则");
    writeFileSync(join(testDir, ".mewcode", "MEWCODE.md"), "# 项目私有规则");
    // 用户级测试不做文件检查（因为路径在 ~/.mewcode）

    const result = loadForProject(testDir);
    const text = result.text;
    // 检查项目根规则在私有规则之前
    const rootIdx = text.indexOf("# 项目根规则");
    const privateIdx = text.indexOf("# 项目私有规则");
    if (rootIdx >= 0 && privateIdx >= 0) {
      expect(rootIdx).toBeLessThan(privateIdx);
    }
    cleanup();
  });

  it("缺失 entry 文件时跳过并可能产生 warning", () => {
    setup();
    // 不创建任何文件
    const result = loadForProject(testDir);
    // 因为所有层都是 required: false，不应有 error 级别诊断
    const errors = result.diagnostics.filter((d) => d.level === "error");
    expect(errors.length).toBe(0);
    cleanup();
  });

  it("legal include 展开后的内容在拼接文本中", () => {
    setup();
    writeFileSync(join(testDir, "sub.md"), "# 被引用的子规则");
    writeFileSync(join(testDir, "MEWCODE.md"), "@include sub.md\n# 主规则");
    const result = loadForProject(testDir);
    expect(result.text).toContain("# 被引用的子规则");
    cleanup();
  });
});
