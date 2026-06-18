import { describe, it, expect } from "vitest";
import {
  instructionSection,
  memorySection,
} from "../../prompt/sections.js";
import { SystemPromptBuilder } from "../../prompt/builder.js";
import {
  identitySection,
  constraintsSection,
  taskModeSection,
  actionSection,
  toolUseSection,
  toneSection,
  outputSection,
} from "../../prompt/sections.js";

describe("bootstrap prompt sections", () => {
  it("项目指令 section 优先级在固定 section 之前", () => {
    const builder = new SystemPromptBuilder();
    builder.add(instructionSection("项目规则: 使用 TypeScript"));
    builder.add(identitySection());
    builder.add(constraintsSection());
    builder.add(taskModeSection());
    builder.add(actionSection());
    builder.add(toolUseSection());
    builder.add(toneSection());
    builder.add(outputSection());
    const result = builder.build();
    // 项目规则应出现在身份 section 之前
    const instrIdx = result.indexOf("项目规则: 使用 TypeScript");
    const identIdx = result.indexOf("你是 Codia");
    expect(instrIdx).toBeLessThan(identIdx);
  });

  it("记忆索引 section 正常注入", () => {
    const builder = new SystemPromptBuilder();
    builder.add(identitySection());
    builder.add(memorySection("## 项目记忆\n- [project_knowledge] 这是一个测试项目\n## 用户记忆\n- [user_preference] 使用中文"));
    const result = builder.build();
    expect(result).toContain("项目记忆");
    expect(result).toContain("用户记忆");
    expect(result).toContain("测试项目");
    expect(result).toContain("使用中文");
  });

  it("空记忆索引不影响正常构建", () => {
    const builder = new SystemPromptBuilder();
    builder.add(identitySection());
    builder.add(memorySection(""));
    const result = builder.build();
    expect(result).toContain("你是 Codia");
  });
});
