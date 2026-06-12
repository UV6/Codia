import { describe, it, expect } from "vitest";
import { SystemPromptBuilder } from "../../prompt/builder.js";
import type { Section } from "../../prompt/types.js";

function makeSection(name: string, priority: number, content?: string): Section {
  return { name, priority, content: content ?? `${name} 内容` };
}

describe("SystemPromptBuilder", () => {
  describe("build", () => {
    it("空 builder 返回空字符串", () => {
      const builder = new SystemPromptBuilder();
      expect(builder.build()).toBe("");
    });

    it("按 priority 升序排列 section", () => {
      const builder = new SystemPromptBuilder();
      builder.add(makeSection("C", 3));
      builder.add(makeSection("A", 1));
      builder.add(makeSection("B", 2));

      const output = builder.build();
      const lines = output.split("\n\n");
      expect(lines[0]).toBe("A 内容");
      expect(lines[1]).toBe("B 内容");
      expect(lines[2]).toBe("C 内容");
    });

    it("模块间以两个换行分隔", () => {
      const builder = new SystemPromptBuilder();
      builder.add(makeSection("A", 1, "AAA"));
      builder.add(makeSection("B", 2, "BBB"));

      const output = builder.build();
      expect(output).toBe("AAA\n\nBBB");
    });
  });

  describe("set", () => {
    it("替换已存在的 section", () => {
      const builder = new SystemPromptBuilder();
      builder.add(makeSection("身份", 1, "旧身份"));
      builder.set(makeSection("身份", 1, "新身份"));

      const output = builder.build();
      expect(output).toBe("新身份");
    });

    it("不存在则追加", () => {
      const builder = new SystemPromptBuilder();
      builder.add(makeSection("A", 1, "内容A"));
      builder.set(makeSection("B", 2, "内容B"));

      expect(builder.build()).toBe("内容A\n\n内容B");
    });
  });

  describe("debug", () => {
    it("输出含模块名和 priority", () => {
      const builder = new SystemPromptBuilder();
      builder.add(makeSection("身份", 1, "identity content"));
      builder.add(makeSection("工具使用", 5, "tool content"));

      const debug = builder.debug();
      expect(debug).toContain("[1] 身份");
      expect(debug).toContain("[5] 工具使用");
      expect(debug).toContain("字符");
    });
  });
});
