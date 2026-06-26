import { describe, it, expect } from "vitest";
import { summarizeDenyReason } from "../../tui/chat-view.js";

describe("summarizeDenyReason", () => {
  it("提取 Hook 拒绝原因", () => {
    const content = '[系统拦截] 工具 write_file({"filePath":"hi.json"}) 被 Hook 规则拒绝：禁止直接写入 JSON 文件，请使用专用工具';
    expect(summarizeDenyReason(content)).toBe("禁止直接写入 JSON 文件，请使用专用工具");
  });

  it("提取权限拒绝原因", () => {
    const content = '权限被拒绝：权限模式 "default" 要求确认 run_command 操作。请调整你的操作方式。';
    expect(summarizeDenyReason(content)).toBe('权限模式 "default" 要求确认 run_command 操作');
  });

  it("无法识别前缀时回退原文", () => {
    const content = "自定义拒绝原因";
    expect(summarizeDenyReason(content)).toBe("自定义拒绝原因");
  });
});
