import type { Skill, SkillSummary, SkillLoadResult, SkillDiagnostic } from "./types.js";

// ARG_REGEX —— 匹配 {{arg1}}、{{arg2}} 等占位符
const ARG_REGEX = /\{\{(\w+)\}\}/g;

// SkillRegistry —— Skill 注册中心
// 持有摘要列表和已激活 Skill，管理工具白名单
export class SkillRegistry {
  private summaries: SkillSummary[] = [];
  private fullSkills = new Map<string, Skill>(); // name → Skill（用于白名单校验）
  private activeSkills = new Map<string, { skill: Skill; body: string }>();

  // setSummaries —— 启动时设置摘要列表
  setSummaries(summaries: SkillSummary[]): void {
    this.summaries = summaries;
  }

  // setFullSkills —— 存储完整 Skill 列表（用于白名单校验）
  setFullSkills(skills: Skill[]): void {
    this.fullSkills.clear();
    for (const skill of skills) {
      this.fullSkills.set(skill.frontmatter.name, skill);
    }
  }

  // getSummaries —— 获取阶段一摘要
  getSummaries(): SkillSummary[] {
    return this.summaries;
  }

  // activate —— 激活 Skill，做参数替换
  activate(skill: Skill, args?: string[]): SkillLoadResult {
    let body = skill.body;

    // 参数替换：{{arg1}} → args[0], {{arg2}} → args[1]...
    if (args && args.length > 0) {
      body = body.replace(ARG_REGEX, (_match, name: string) => {
        // arg1 → index 0, arg2 → index 1 ...
        const idx = parseInt(name.replace("arg", ""), 10) - 1;
        if (idx >= 0 && idx < args.length) {
          return args[idx];
        }
        return _match; // 无法替换则保留原文
      });
    }

    this.activeSkills.set(skill.frontmatter.name, { skill, body });

    // 收集资源文件列表（目录型 Skill）
    const resources: string[] = [];
    if (skill.dir) {
      resources.push(`目录路径: ${skill.dir}`);
    }

    return {
      name: skill.frontmatter.name,
      mode: skill.frontmatter.mode,
      body,
      resources,
    };
  }

  // deactivate —— 反激活单个 Skill
  deactivate(name: string): void {
    this.activeSkills.delete(name);
  }

  // clear —— 清空所有激活
  clear(): void {
    this.activeSkills.clear();
  }

  // getActiveSkillBodies —— 获取所有激活 Skill 的正文
  getActiveSkillBodies(): string[] {
    return Array.from(this.activeSkills.values()).map((v) => v.body);
  }

  // getActiveSummaries —— 获取激活 Skill 的状态行
  getActiveSummaries(): string[] {
    return Array.from(this.activeSkills.values()).map(
      (v) => `[${v.skill.frontmatter.name}] ${v.skill.frontmatter.mode} 激活中`,
    );
  }

  // getActiveSkills —— 获取所有已激活 Skill 的原始对象
  getActiveSkills(): Skill[] {
    return Array.from(this.activeSkills.values()).map((v) => v.skill);
  }

  // isActive —— 检查 Skill 是否已激活
  isActive(name: string): boolean {
    return this.activeSkills.has(name);
  }

  // getEffectiveAllowedTools —— 计算有效工具白名单
  // 多 Skill 取并集；有任一不限则返回全部；始终包含 LoadSkill
  getEffectiveAllowedTools(allTools: string[]): string[] {
    const active = this.getActiveSkills();
    if (active.length === 0) return allTools;

    const toolSet = new Set<string>();

    for (const skill of active) {
      if (!skill.frontmatter.allowedTools || skill.frontmatter.allowedTools.length === 0) {
        // 任一 Skill 不限工具，返回全部
        return allTools;
      }
      for (const t of skill.frontmatter.allowedTools) {
        toolSet.add(t);
      }
    }

    // 始终包含 LoadSkill
    toolSet.add("LoadSkill");

    // 过滤到实际存在的工具
    const allToolSet = new Set(allTools);
    toolSet.add("LoadSkill");
    return Array.from(toolSet).filter((t) => allToolSet.has(t));
  }

  // validateAllowedTools —— 校验所有 Skill 的白名单
  // 仅校验内置工具（传入的 allToolNames 应排除 MCP 工具）
  validateAllowedTools(allToolNames: Set<string>): SkillDiagnostic[] {
    const diagnostics: SkillDiagnostic[] = [];

    for (const [name, skill] of this.fullSkills) {
      const allowed = skill.frontmatter.allowedTools;
      if (!allowed || allowed.length === 0) continue;

      for (const toolName of allowed) {
        if (toolName === "LoadSkill") continue; // LoadSkill 总是存在
        if (!allToolNames.has(toolName)) {
          diagnostics.push({
            filePath: skill.source,
            level: "error",
            message: `Skill "${name}" 的 allowedTools 引用了不存在的工具 "${toolName}"`,
          });
        }
      }
    }

    return diagnostics;
  }
}
