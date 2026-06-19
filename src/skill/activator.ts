import type { SkillRegistry } from "./registry.js";
import type { SkillLoadResult } from "./types.js";
import { loadOne } from "./loader.js";

// SkillActivator —— Skill 激活协调器
export class SkillActivator {
  private registry: SkillRegistry;
  private projectRoot: string;

  constructor(registry: SkillRegistry, projectRoot: string) {
    this.registry = registry;
    this.projectRoot = projectRoot;
  }

  // loadSkill —— 按名加载并激活 Skill
  loadSkill(name: string, args?: string[]): SkillLoadResult | null {
    const skill = loadOne(name, this.projectRoot);
    if (!skill) return null;

    return this.registry.activate(skill, args);
  }

  // loadSkillByIntent —— 意图匹配
  loadSkillByIntent(task: string): SkillLoadResult | null {
    const summaries = this.registry.getSummaries();
    const lowerTask = task.toLowerCase();

    // 1. 精确匹配 name
    for (const s of summaries) {
      if (lowerTask.includes(s.name.toLowerCase())) {
        return this.loadSkill(s.name);
      }
    }

    // 2. 完整 description 包含匹配
    for (const s of summaries) {
      const desc = s.description.toLowerCase();
      if (lowerTask.includes(desc)) return this.loadSkill(s.name);
    }

    // 3. description 的部分内容出现在 task 中
    // 对中文：提取 2-gram 作为匹配单元
    for (const s of summaries) {
      const desc = s.description.toLowerCase();
      const words = desc.split(/[\s,，、。.]+/);
      for (const w of words) {
        if (w.length >= 2 && lowerTask.includes(w)) {
          return this.loadSkill(s.name);
        }
        // 中文 2-gram: 从每个词中提取连续两个字符
        for (let i = 0; i < w.length - 1; i++) {
          const pair = w.slice(i, i + 2);
          if (lowerTask.includes(pair)) return this.loadSkill(s.name);
        }
      }
    }

    return null;
  }

  // reloadSkill —— 热更新：重新加载已激活的 Skill
  reloadSkill(name: string): SkillLoadResult | null {
    if (!this.registry.isActive(name)) return null;
    return this.loadSkill(name);
  }
}
