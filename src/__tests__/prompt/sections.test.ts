import { describe, it, expect } from "vitest";
import {
  identitySection,
  constraintsSection,
  taskModeSection,
  actionSection,
  toolUseSection,
  toneSection,
  outputSection,
} from "../../prompt/sections.js";

const allSections = [
  identitySection(),
  constraintsSection(),
  taskModeSection(),
  actionSection(),
  toolUseSection(),
  toneSection(),
  outputSection(),
];

describe("Sections", () => {
  it("七个函数均返回非空 Section", () => {
    for (const section of allSections) {
      expect(section.name).toBeTruthy();
      expect(section.priority).toBeGreaterThan(0);
      expect(section.content.length).toBeGreaterThan(10);
    }
  });

  it("七个 priority 唯一", () => {
    const priorities = allSections.map((s) => s.priority);
    const unique = new Set(priorities);
    expect(unique.size).toBe(allSections.length);
  });

  it("priority 范围 1-7", () => {
    for (const section of allSections) {
      expect(section.priority).toBeGreaterThanOrEqual(1);
      expect(section.priority).toBeLessThanOrEqual(7);
    }
  });

  it("身份 section 含项目名", () => {
    const s = identitySection();
    expect(s.content).toContain("Codia");
    expect(s.priority).toBe(1);
  });

  it("动作执行 section 含编辑前必读规则", () => {
    const s = actionSection();
    expect(s.content).toContain("编辑前必须先读取文件内容");
  });

  it("工具使用 section 含优先用专用工具规则", () => {
    const s = toolUseSection();
    expect(s.content).toContain("优先使用专用工具");
  });
});
