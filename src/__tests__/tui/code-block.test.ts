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

  it("未知 class 的 span 渲染为无颜色", () => {
    const segments = parseHighlightedLine(
      '<span class="unknown-class">text</span>',
    );
    expect(segments).toEqual([{ text: "text" }]);
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
});
