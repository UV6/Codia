import { describe, it, expect } from "vitest";
import { INTERCEPT_EVENTS, DEFAULT_CONTROL } from "../../hook/types.js";

describe("Hook types", () => {
  it("INTERCEPT_EVENTS 包含 pre_tool", () => {
    expect(INTERCEPT_EVENTS).toContain("pre_tool");
    expect(INTERCEPT_EVENTS).toHaveLength(1);
  });

  it("DEFAULT_CONTROL 默认值正确", () => {
    expect(DEFAULT_CONTROL).toEqual({
      run_once: false,
      background: false,
      timeout: 30000,
    });
  });
});
