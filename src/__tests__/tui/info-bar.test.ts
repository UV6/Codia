import { describe, expect, it } from "vitest";
import {
  formatAgentRoleLabel,
  formatSessionFileLabel,
} from "../../tui/info-bar.js";

describe("formatAgentRoleLabel", () => {
  it("用明确文案展示可用角色数量", () => {
    expect(formatAgentRoleLabel(4)).toBe("Agent×4");
  });
});

describe("formatSessionFileLabel", () => {
  it("短文件名保持原样", () => {
    expect(formatSessionFileLabel("session.jsonl")).toBe("📁 session.jsonl");
  });

  it("长文件名截断，给前面的状态项留空间", () => {
    expect(
      formatSessionFileLabel("2026-07-01-very-long-session-name-for-codia.jsonl"),
    ).toBe("📁 2026-07-01-very-long-ses…");
  });
});
