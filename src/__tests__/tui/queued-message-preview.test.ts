import { describe, expect, it } from "vitest";
import { buildQueuedMessagePreviewLines } from "../../tui/queued-message-preview.js";

describe("buildQueuedMessagePreviewLines", () => {
  it("为空时不展示任何排队消息", () => {
    expect(buildQueuedMessagePreviewLines([])).toEqual([]);
  });

  it("展示排队标题和每条消息预览", () => {
    expect(buildQueuedMessagePreviewLines(["第二个问题", "第三个问题"])).toEqual([
      "⏳ 队列中 2 条待回复消息",
      "  1. 第二个问题",
      "  2. 第三个问题",
    ]);
  });

  it("超长消息会截断，避免撑满输入区域", () => {
    const lines = buildQueuedMessagePreviewLines([
      "这是一个非常非常非常非常非常非常长的问题，需要被截断展示",
    ]);

    expect(lines[0]).toBe("⏳ 队列中 1 条待回复消息");
    expect(lines[1]?.startsWith("  1. 这是一个非常非常")).toBe(true);
    expect(lines[1]?.endsWith("…")).toBe(true);
  });
});
