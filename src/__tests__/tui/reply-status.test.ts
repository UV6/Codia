import { describe, expect, it } from "vitest";
import { getReplyStatusLabel } from "../../tui/reply-status.js";

describe("getReplyStatusLabel", () => {
  it("未流式输出时不显示状态", () => {
    expect(getReplyStatusLabel(false, "", "")).toBeNull();
  });

  it("流式开始但还没输出正文时显示思考中", () => {
    expect(getReplyStatusLabel(true, "", "")).toBe("思考中...");
    expect(getReplyStatusLabel(true, "", "先分析一下")).toBe("思考中...");
  });

  it("一旦开始输出正文就切换为输出中", () => {
    expect(getReplyStatusLabel(true, "这是回答", "")).toBe("输出中...");
    expect(getReplyStatusLabel(true, "这是回答", "之前有思考")).toBe("输出中...");
  });
});
