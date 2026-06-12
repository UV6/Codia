import type { Section } from "./types.js";

// SystemPromptBuilder —— 收集 Section，按优先级排序，拼装最终 system prompt 文本
export class SystemPromptBuilder {
  private sections: Section[] = [];

  // add —— 追加 section，自动按 priority 升序
  add(section: Section): void {
    this.sections.push(section);
    this.sections.sort((a, b) => a.priority - b.priority);
  }

  // set —— 按 name 替换已存在的 section，不存在则追加
  set(section: Section): void {
    const idx = this.sections.findIndex((s) => s.name === section.name);
    if (idx !== -1) {
      this.sections[idx] = section;
    } else {
      this.add(section);
    }
  }

  // build —— 按 priority 顺序拼接所有 section，模块间两个空行分隔
  build(): string {
    return this.sections.map((s) => s.content).join("\n\n");
  }

  // debug —— 返回各模块 name、priority、content 长度的摘要
  debug(): string {
    return this.sections
      .map((s) => `[${s.priority}] ${s.name} (${s.content.length} 字符)`)
      .join("\n");
  }
}
