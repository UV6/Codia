import { describe, it, expect, beforeEach } from "vitest";
import {
  wrapReminder,
  reminderToMessage,
  PlanModeReminderProvider,
} from "../../prompt/reminders.js";
import type { SystemReminder } from "../../prompt/types.js";

function makeReminder(overrides: Partial<SystemReminder> = {}): SystemReminder {
  return {
    source: "test",
    content: "测试提醒内容",
    round: 0,
    ...overrides,
  };
}

describe("Reminders", () => {
  describe("wrapReminder", () => {
    it("输出含 <system-reminder> 标签", () => {
      const r = makeReminder({ content: "环境信息" });
      const wrapped = wrapReminder(r);
      expect(wrapped).toContain("<system-reminder>");
      expect(wrapped).toContain("</system-reminder>");
      expect(wrapped).toContain("环境信息");
    });

    it("标签包裹在内容前后", () => {
      const r = makeReminder({ content: "hello world" });
      const wrapped = wrapReminder(r);
      expect(wrapped).toBe("<system-reminder>\nhello world\n</system-reminder>");
    });
  });

  describe("reminderToMessage", () => {
    it("生成 role=user 的消息", () => {
      const r = makeReminder();
      const msg = reminderToMessage(r);
      expect(msg.role).toBe("user");
    });

    it("content 含 <system-reminder> 标签", () => {
      const r = makeReminder({ content: "Plan Mode 已激活" });
      const msg = reminderToMessage(r);
      expect(msg.content).toContain("<system-reminder>");
      expect(msg.content).toContain("Plan Mode 已激活");
      expect(msg.content).toContain("</system-reminder>");
    });

    it("timestamp 为 ISO 格式", () => {
      const r = makeReminder();
      const msg = reminderToMessage(r);
      expect(msg.timestamp).toBeTruthy();
      expect(() => new Date(msg.timestamp)).not.toThrow();
    });
  });

  describe("PlanModeReminderProvider", () => {
    let provider: PlanModeReminderProvider;

    beforeEach(() => {
      provider = new PlanModeReminderProvider("test-plan.md");
    });

    it("未激活时返回空数组", () => {
      expect(provider.getReminders(0)).toEqual([]);
    });

    it("激活轮次返回完整 prompt", () => {
      provider.activate(2);
      const reminders = provider.getReminders(2);
      expect(reminders.length).toBe(1);
      expect(reminders[0].source).toBe("plan-mode");
      expect(reminders[0].content).toContain("Plan Mode（计划模式）");
      expect(reminders[0].content).toContain("test-plan.md");
    });

    it("后续轮次返回简短标签", () => {
      provider.activate(2);
      const reminders = provider.getReminders(5); // round 5, not activation round
      expect(reminders.length).toBe(1);
      expect(reminders[0].content).not.toContain("Plan Mode（计划模式）");
      expect(reminders[0].content).toContain("Plan Mode 已激活");
      expect(reminders[0].content).toContain("test-plan.md");
    });

    it("deactivate 后返回空", () => {
      provider.activate(2);
      provider.deactivate();
      expect(provider.getReminders(3)).toEqual([]);
    });

    it("toProvider 返回的函数可正常调用", () => {
      const fn = provider.toProvider();
      provider.activate(0);
      const results = fn(0);
      expect(results.length).toBe(1);
      expect(results[0].source).toBe("plan-mode");
    });
  });
});
