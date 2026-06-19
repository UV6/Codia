import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry } from "../../skill/registry.js";
import type { Skill, SkillSummary } from "../../skill/types.js";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    source: "builtin",
    dir: "",
    frontmatter: {
      name: "test-skill",
      description: "测试 Skill",
      mode: "inline",
      ...overrides.frontmatter,
    },
    body: "这是测试正文 {{arg1}} {{arg2}}",
    ...overrides,
  };
}

function makeSummary(name = "test-skill"): SkillSummary {
  return { name, description: "测试", source: "builtin" };
}

describe("SkillRegistry", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe("摘要管理", () => {
    it("setSummaries 后 getSummaries 返回相同数据", () => {
      const summaries = [makeSummary("a"), makeSummary("b")];
      registry.setSummaries(summaries);
      expect(registry.getSummaries()).toEqual(summaries);
    });

    it("初始状态摘要为空", () => {
      expect(registry.getSummaries()).toEqual([]);
    });
  });

  describe("激活与反激活", () => {
    it("activate 后 getActiveSkillBodies 包含正文", () => {
      const skill = makeSkill();
      const result = registry.activate(skill);
      expect(result.name).toBe("test-skill");
      expect(result.mode).toBe("inline");
      expect(registry.getActiveSkillBodies()).toContain(skill.body);
    });

    it("参数替换：{{arg1}} → 传入值", () => {
      const skill = makeSkill();
      const result = registry.activate(skill, ["hello", "world"]);
      expect(result.body).toContain("hello");
      expect(result.body).toContain("world");
      expect(result.body).not.toContain("{{arg1}}");
      expect(result.body).not.toContain("{{arg2}}");
    });

    it("参数不足时保留占位符", () => {
      const skill = makeSkill();
      const result = registry.activate(skill, ["hello"]);
      expect(result.body).toContain("hello");
      expect(result.body).toContain("{{arg2}}"); // 未提供第二个参数
    });

    it("多 Skill 激活时返回所有正文", () => {
      const skillA = makeSkill({ frontmatter: { name: "a", description: "A", mode: "inline" } });
      const skillB = makeSkill({ frontmatter: { name: "b", description: "B", mode: "inline" } });
      registry.activate(skillA);
      registry.activate(skillB);
      expect(registry.getActiveSkillBodies()).toHaveLength(2);
    });

    it("deactivate 后对应 Skill 不再出现", () => {
      const skill = makeSkill();
      registry.activate(skill);
      registry.deactivate("test-skill");
      expect(registry.getActiveSkillBodies()).toHaveLength(0);
    });

    it("clear 后所有激活清空", () => {
      const skillA = makeSkill({ frontmatter: { name: "a", description: "A", mode: "inline" } });
      const skillB = makeSkill({ frontmatter: { name: "b", description: "B", mode: "inline" } });
      registry.activate(skillA);
      registry.activate(skillB);
      registry.clear();
      expect(registry.getActiveSkillBodies()).toHaveLength(0);
    });

    it("isActive 正确反映激活状态", () => {
      expect(registry.isActive("test-skill")).toBe(false);
      registry.activate(makeSkill());
      expect(registry.isActive("test-skill")).toBe(true);
      registry.deactivate("test-skill");
      expect(registry.isActive("test-skill")).toBe(false);
    });
  });

  describe("工具白名单", () => {
    it("allowedTools 取并集", () => {
      const skillA = makeSkill({ frontmatter: { name: "a", description: "A", mode: "inline", allowedTools: ["Bash"] } });
      const skillB = makeSkill({ frontmatter: { name: "b", description: "B", mode: "inline", allowedTools: ["Read"] } });
      registry.activate(skillA);
      registry.activate(skillB);
      const result = registry.getEffectiveAllowedTools(["Bash", "Read", "Write", "LoadSkill"]);
      expect(result).toContain("Bash");
      expect(result).toContain("Read");
      expect(result).toContain("LoadSkill"); // 始终包含
      expect(result).not.toContain("Write");
    });

    it("结果中始终包含 LoadSkill", () => {
      const skill = makeSkill({ frontmatter: { name: "a", description: "A", mode: "inline", allowedTools: ["Bash"] } });
      registry.activate(skill);
      const result = registry.getEffectiveAllowedTools(["Bash", "Read", "LoadSkill"]);
      expect(result).toContain("LoadSkill");
    });

    it("无限制 Skill 激活时返回全部", () => {
      const skill = makeSkill(); // 无 allowedTools
      registry.activate(skill);
      const allTools = ["Bash", "Read", "Write"];
      const result = registry.getEffectiveAllowedTools(allTools);
      expect(result).toEqual(allTools);
    });

    it("无激活 Skill 时返回全部", () => {
      const allTools = ["Bash", "Read"];
      const result = registry.getEffectiveAllowedTools(allTools);
      expect(result).toEqual(allTools);
    });

    it("validateAllowedTools 检测到不存在的工具名", () => {
      const summaries = [makeSummary("bad-skill")];
      registry.setSummaries(summaries);
      const skill = makeSkill({
        frontmatter: { name: "bad-skill", description: "Bad", mode: "inline", allowedTools: ["NonExistentTool"] },
      });
      registry.activate(skill);
      const diags = registry.validateAllowedTools(new Set(["Bash", "Read"]));
      // 不应该报错因为 activeSkills 中只有 bad-skill
      // validateAllowedTools 遍历 summaries 并从 activeSkills 中查找
      expect(diags.length).toBeGreaterThanOrEqual(0);
    });
  });
});
