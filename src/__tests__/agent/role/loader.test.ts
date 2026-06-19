import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadFromDir } from "../../../agent/role/loader.js";

describe("loadFromDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `codia-agent-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("解析有效的角色文件", () => {
    writeFileSync(
      join(tmpDir, "reviewer.md"),
      [
        "---",
        "name: code-reviewer",
        "description: 代码审查专家",
        "model: sonnet",
        "maxRounds: 10",
        "tools:",
        "  - read_file",
        "  - glob",
        "disallowedTools:",
        "  - run_command",
        "---",
        "",
        "你是代码审查专家，负责审查代码质量。",
      ].join("\n"),
    );

    const roles = loadFromDir(tmpDir, "user");
    expect(roles).toHaveLength(1);
    const role = roles[0];
    expect(role.frontmatter.name).toBe("code-reviewer");
    expect(role.frontmatter.description).toBe("代码审查专家");
    expect(role.frontmatter.model).toBe("sonnet");
    expect(role.frontmatter.maxRounds).toBe(10);
    expect(role.frontmatter.tools).toEqual(["read_file", "glob"]);
    expect(role.frontmatter.disallowedTools).toEqual(["run_command"]);
    expect(role.body).toBe("你是代码审查专家，负责审查代码质量。");
    expect(role.source).toBe("user");
    expect(role.filePath).toContain("reviewer.md");
  });

  it("缺 name 字段时跳过并告警", () => {
    writeFileSync(
      join(tmpDir, "bad.md"),
      [
        "---",
        "description: 没有名字",
        "---",
        "body",
      ].join("\n"),
    );

    const roles = loadFromDir(tmpDir, "user");
    expect(roles).toHaveLength(0);
  });

  it("缺 description 字段时跳过", () => {
    writeFileSync(
      join(tmpDir, "bad.md"),
      [
        "---",
        "name: no-desc",
        "---",
        "body",
      ].join("\n"),
    );

    const roles = loadFromDir(tmpDir, "user");
    expect(roles).toHaveLength(0);
  });

  it("无 frontmatter 时跳过", () => {
    writeFileSync(join(tmpDir, "nofm.md"), "只有正文，没有 frontmatter");

    const roles = loadFromDir(tmpDir, "user");
    expect(roles).toHaveLength(0);
  });

  it("忽略非 .md 文件", () => {
    writeFileSync(join(tmpDir, "notes.txt"), "不是 md 文件");

    const roles = loadFromDir(tmpDir, "user");
    expect(roles).toHaveLength(0);
  });

  it("model 为合法值时正常解析", () => {
    for (const model of ["inherit", "haiku", "sonnet", "opus"]) {
      writeFileSync(
        join(tmpDir, `${model}.md`),
        [
          "---",
          `name: role-${model}`,
          "description: test",
          `model: ${model}`,
          "---",
          "body",
        ].join("\n"),
      );
    }

    const roles = loadFromDir(tmpDir, "user");
    expect(roles).toHaveLength(4);
  });

  it("空目录返回空数组", () => {
    const roles = loadFromDir(tmpDir, "user");
    expect(roles).toEqual([]);
  });

  it("不存在的目录返回空数组", () => {
    const roles = loadFromDir("/nonexistent/path/12345", "user");
    expect(roles).toEqual([]);
  });
});
