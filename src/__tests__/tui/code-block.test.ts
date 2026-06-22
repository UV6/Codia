import { describe, it, expect } from "vitest";
import { parseHighlightedLine } from "../../tui/code-block.js";

describe("parseHighlightedLine", () => {
  it("无 span 标签的纯文本行返回单个无色 segment", () => {
    const segments = parseHighlightedLine("const x = 1;");
    expect(segments).toEqual([{ text: "const x = 1;" }]);
  });

  it("单个 hljs-keyword span", () => {
    const segments = parseHighlightedLine(
      '<span class="hljs-keyword">const</span>',
    );
    expect(segments).toEqual([
      { text: "const", color: "magenta" },
    ]);
  });

  it("混合 span 和纯文本", () => {
    const segments = parseHighlightedLine(
      '<span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span>;',
    );
    expect(segments).toEqual([
      { text: "const", color: "magenta" },
      { text: " x = " },
      { text: "1", color: "yellow" },
      { text: ";" },
    ]);
  });

  it("多 class 的 span 取第一个匹配颜色", () => {
    const segments = parseHighlightedLine(
      '<span class="hljs-title class_">MyClass</span>',
    );
    expect(segments).toEqual([
      { text: "MyClass", color: "cyan" },
    ]);
  });

  it("空行返回空数组", () => {
    const segments = parseHighlightedLine("");
    expect(segments).toEqual([]);
  });

  it("未知 class 的 span 降级为白色", () => {
    const segments = parseHighlightedLine(
      '<span class="unknown-class">text</span>',
    );
    expect(segments).toEqual([{ text: "text", color: "white" }]);
  });

  it("hljs-string 映射为绿色", () => {
    const segments = parseHighlightedLine(
      '<span class="hljs-string">"hello"</span>',
    );
    expect(segments).toEqual([
      { text: '"hello"', color: "green" },
    ]);
  });

  it("hljs-comment 映射为灰色", () => {
    const segments = parseHighlightedLine(
      '<span class="hljs-comment">// comment</span>',
    );
    expect(segments).toEqual([
      { text: "// comment", color: "grey" },
    ]);
  });

  it("&amp; &lt; &gt; &quot; HTML 实体解码", () => {
    const segments = parseHighlightedLine(
      '<span class="hljs-string">"x &lt; 10 &amp;&amp; y &gt; 5"</span>',
    );
    expect(segments).toEqual([
      { text: '"x < 10 && y > 5"', color: "green" },
    ]);
  });

  // 核心 case：嵌套 span 不会导致外层标签原样输出
  it("嵌套 span 正确提取所有文本，不残留 HTML 标签", () => {
    const segments = parseHighlightedLine(
      '<span class="hljs-strong">**粗体 <span class="hljs-emphasis">*斜体*</span> 混合**</span>',
    );
    // 不应出现任何含 <span 的 segment
    const hasHtml = segments.some((s) => s.text.includes("<span"));
    expect(hasHtml).toBe(false);
    // 所有文本拼接回来与原文语义一致
    const combined = segments.map((s) => s.text).join("");
    expect(combined).toBe("**粗体 *斜体* 混合**");
  });

  it("三层嵌套也不残留 HTML 标签", () => {
    const segments = parseHighlightedLine(
      '<span class="hljs-strong">**<span class="hljs-emphasis">*<span class="hljs-code">code</span>*</span>**</span>',
    );
    const hasHtml = segments.some((s) => s.text.includes("<span"));
    expect(hasHtml).toBe(false);
    const combined = segments.map((s) => s.text).join("");
    expect(combined).toBe("***code***");
    // Note: inner-most text takes precedence; since hljs-emphasis and hljs-strong
    // both map to white, the visible result is consistent
  });
});
