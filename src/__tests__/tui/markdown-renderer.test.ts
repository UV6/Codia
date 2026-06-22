import { describe, it, expect } from "vitest";
import { splitUnclosedFence } from "../../tui/markdown-renderer.js";

describe("splitUnclosedFence", () => {
  it("所有围栏已闭合时返回完整 safe，tail 为空", () => {
    const text = "```ts\nconst x = 1;\n```";
    const { safe, tail } = splitUnclosedFence(text);
    expect(tail).toBe("");
    expect(safe).toBe(text);
  });

  it("无围栏时全文本为 safe", () => {
    const text = "这是一段普通文本，没有代码块。";
    const { safe, tail } = splitUnclosedFence(text);
    expect(safe).toBe(text);
    expect(tail).toBe("");
  });

  it("末尾有未闭合围栏时拆分为 safe + tail", () => {
    const text = "前面的内容\n```ts\nconst x = 1;";
    const { safe, tail } = splitUnclosedFence(text);
    expect(safe).toBe("前面的内容");
    expect(tail).toBe("```ts\nconst x = 1;");
  });

  it("多个代码块，仅最后一个未闭合", () => {
    const text =
      "```ts\nconst a = 1;\n```\n\n中间文本\n```python\nprint('hi')";
    const { safe, tail } = splitUnclosedFence(text);
    expect(safe).toBe(
      "```ts\nconst a = 1;\n```\n\n中间文本",
    );
    expect(tail).toBe("```python\nprint('hi')");
  });

  it("空文本不崩溃", () => {
    const { safe, tail } = splitUnclosedFence("");
    expect(safe).toBe("");
    expect(tail).toBe("");
  });

  it("仅一个未闭合的围栏行（只有开头三个反引号）", () => {
    const text = "hello\n```";
    const { safe, tail } = splitUnclosedFence(text);
    expect(safe).toBe("hello");
    expect(tail).toBe("```");
  });

  it("围栏后跟语言名也正确识别", () => {
    const text = "text\n```javascript\ncode";
    const { safe, tail } = splitUnclosedFence(text);
    expect(safe).toBe("text");
    expect(tail).toBe("```javascript\ncode");
  });
});
