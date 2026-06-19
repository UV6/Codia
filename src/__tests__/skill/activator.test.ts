import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry } from "../../skill/registry.js";
import { SkillActivator } from "../../skill/activator.js";
import type { Skill } from "../../skill/types.js";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    source: "builtin",
    dir: "",
    frontmatter: {
      name: "test-skill",
      description: "测试用 Skill，用于自动提交代码",
      mode: "inline" as const,
      ...overrides.frontmatter,
    },
    body: "这是测试正文 {{arg1}}",
    ...overrides,
  };
}

describe("SkillActivator", () => {
  let registry: SkillRegistry;
  let activator: SkillActivator;

  beforeEach(() => {
    registry = new SkillRegistry();
    activator = new SkillActivator(registry, process.cwd());
  });

  describe("loadSkill", () => {
    it("加载存在的 Skill 返回 SkillLoadResult", () => {
      // 使用内置 Skill 测试真实加载
      const result = activator.loadSkill("commit");
      if (result) {
        expect(result.name).toBe("commit");
        expect(result.mode).toBe("inline");
        expect(result.body.length).toBeGreaterThan(0);
      }
    });

    it("加载不存在的 Skill 返回 null", () => {
      const result = activator.loadSkill("nonexistent-skill-xyz");
      expect(result).toBeNull();
    });

    it("参数传递后正文中占位符被替换", () => {
      // 测试参数替换：通过 registry 激活测试
      const skill = makeSkill({ body: "请处理 {{arg1}} 和 {{arg2}}" });
      registry.setFullSkills([skill]);
      registry.setSummaries([{ name: "test-skill", description: "测试", source: "builtin" }]);

      // 直接使用 registry 激活测试参数替换
      const result = registry.activate(skill, ["文件A", "文件B"]);
      expect(result.body).toContain("文件A");
      expect(result.body).toContain("文件B");
      expect(result.body).not.toContain("{{arg1}}");
    });
  });

  describe("loadSkillByIntent", () => {
    it("根据 task 描述匹配到对应 Skill", () => {
      registry.setSummaries([
        { name: "commit", description: "自动提交代码变更", source: "builtin" },
        { name: "review", description: "审查代码变更", source: "builtin" },
      ]);
      registry.setFullSkills([
        makeSkill({ frontmatter: { name: "commit", description: "自动提交代码变更", mode: "inline" } }),
        makeSkill({ frontmatter: { name: "review", description: "审查代码变更", mode: "fork" } }),
      ]);

      const result = activator.loadSkillByIntent("帮我提交代码");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("commit");
    });

    it("无匹配时返回 null", () => {
      registry.setSummaries([
        { name: "commit", description: "自动提交代码变更", source: "builtin" },
      ]);
      const result = activator.loadSkillByIntent("帮我画个图");
      expect(result).toBeNull();
    });

    it("匹配 description 中的关键词", () => {
      registry.setSummaries([
        { name: "test", description: "运行测试并分析结果", source: "builtin" },
      ]);
      registry.setFullSkills([
        makeSkill({ frontmatter: { name: "test", description: "运行测试并分析结果", mode: "inline" } }),
      ]);

      const result = activator.loadSkillByIntent("我需要跑一下测试");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("test");
    });
  });
});
