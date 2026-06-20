import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { MailboxSystem, withFileLock } from "../../team/mailbox-system.js";
import { writeFile, unlink } from "node:fs/promises";

describe("MailboxSystem", () => {
  let tmpDir: string;
  let mailbox: MailboxSystem;

  beforeEach(async () => {
    const id = randomUUID().slice(0, 8);
    tmpDir = join(tmpdir(), `codia-test-mailbox-${id}`);
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(join(tmpDir, "members"), { recursive: true });
    mkdirSync(join(tmpDir, "members", "mailbox"), { recursive: true });
    mailbox = MailboxSystem.fromTeamDir(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("registerMember", () => {
    it("注册表中出现映射", async () => {
      await mailbox.registerMember("alice");
      // 验证邮箱文件存在
      const mailboxFile = join(tmpDir, "members", "mailbox", "alice.json");
      expect(existsSync(mailboxFile)).toBe(true);
    });
  });

  describe("sendMessage", () => {
    it("消息出现于收件人邮箱，含 timestamp 和 read=false", async () => {
      await mailbox.registerMember("alice");
      await mailbox.registerMember("bob");

      const msg = await mailbox.sendMessage({
        from: "alice",
        to: "bob",
        type: "text",
        body: "Hello Bob!",
        summary: "Greeting",
      });

      expect(msg.id).toBeTruthy();
      expect(msg.timestamp).toBeTruthy();
      expect(msg.read).toBe(false);
      expect(msg.from).toBe("alice");
      expect(msg.to).toBe("bob");

      const inbox = await mailbox.readInbox("bob");
      expect(inbox.length).toBeGreaterThanOrEqual(1);
      expect(inbox.some((m) => m.body === "Hello Bob!")).toBe(true);
    });
  });

  describe("broadcast", () => {
    it("所有注册成员都收到消息", async () => {
      await mailbox.registerMember("alice");
      await mailbox.registerMember("bob");
      await mailbox.registerMember("charlie");

      const msgs = await mailbox.broadcast("alice", "announcement", "重要通知");
      expect(msgs.length).toBe(2); // bob, charlie (不含发送者)

      const bobInbox = await mailbox.readInbox("bob");
      const charlieInbox = await mailbox.readInbox("charlie");
      expect(bobInbox.some((m) => m.type === "broadcast")).toBe(true);
      expect(charlieInbox.some((m) => m.type === "broadcast")).toBe(true);

      // alice 不应收到自己的广播
      const aliceInbox = await mailbox.readInbox("alice");
      expect(aliceInbox.length).toBe(0);
    });
  });

  describe("readInbox", () => {
    it("返回未读消息，markAsRead 后消息已读", async () => {
      await mailbox.registerMember("bob");
      await mailbox.sendMessage({
        from: "system", to: "bob", type: "text", body: "msg1", summary: "s1",
      });

      // 首次读取（不标记已读）
      const unread = await mailbox.readInbox("bob", false);
      expect(unread.length).toBe(1);
      expect(unread[0].read).toBe(false);

      // 标记已读
      await mailbox.readInbox("bob", true);

      // 再次读取，消息应已标记为已读
      const read = await mailbox.readInbox("bob");
      expect(read.length).toBe(1);
      expect(read[0].read).toBe(true);
    });
  });

  describe("getMessage", () => {
    it("按 messageId 查找", async () => {
      await mailbox.registerMember("alice");
      const sent = await mailbox.sendMessage({
        from: "system", to: "alice", type: "text", body: "test", summary: "s",
      });
      const found = await mailbox.getMessage("alice", sent.id);
      expect(found).not.toBeNull();
      expect(found!.body).toBe("test");
    });
  });

  describe("markAsRead", () => {
    it("单条标记已读后 read 变为 true", async () => {
      await mailbox.registerMember("alice");
      const msg = await mailbox.sendMessage({
        from: "system", to: "alice", type: "text", body: "test", summary: "s",
      });
      expect(msg.read).toBe(false);

      await mailbox.markAsRead("alice", msg.id);
      const found = await mailbox.getMessage("alice", msg.id);
      expect(found!.read).toBe(true);
    });
  });

  describe("并发安全", () => {
    it("同时写 5 条消息到同一邮箱，所有消息都成功写入", async () => {
      await mailbox.registerMember("alice");

      const promises = Array.from({ length: 5 }, (_, i) =>
        mailbox.sendMessage({
          from: "system",
          to: "alice",
          type: "text",
          body: `message-${i}`,
          summary: `msg ${i}`,
        }),
      );
      const results = await Promise.all(promises);
      expect(results.length).toBe(5);

      const inbox = await mailbox.readInbox("alice");
      expect(inbox.length).toBe(5);
      for (let i = 0; i < 5; i++) {
        expect(inbox.some((m) => m.body === `message-${i}`)).toBe(true);
      }
    });
  });

  describe("unregisterMember", () => {
    it("注销后注册表中移除", async () => {
      await mailbox.registerMember("alice");
      await mailbox.unregisterMember("alice");

      // 注销后发消息应失败
      await expect(
        mailbox.sendMessage({
          from: "system", to: "alice", type: "text", body: "x", summary: "x",
        }),
      ).rejects.toThrow("未注册");
    });
  });

  describe("withFileLock", () => {
    it("过期锁自动清理", async () => {
      const lockPath = join(tmpdir(), `test-lock-${randomUUID().slice(0, 8)}.lock`);
      // 模拟一个31秒前的旧锁文件
      const oldTime = new Date(Date.now() - 31000);
      await writeFile(lockPath, "old-pid", "utf-8");
      // 手动设置 mtime (vitest 环境可能不支持，用 utimesSync)
      const { utimesSync } = await import("node:fs");
      utimesSync(lockPath, oldTime, oldTime);

      // 使用 withFileLock 写入测试文件，应能正常获取锁
      const testPath = lockPath.replace(/\.lock$/, ".test");
      await withFileLock(
        testPath,
        async () => {
          await writeFile(testPath, "ok", "utf-8");
        },
        5,
        30000,
      );

      // 清理
      await unlink(testPath).catch(() => {});
    });
  });
});
