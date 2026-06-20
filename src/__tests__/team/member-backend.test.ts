import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { TeamManager } from "../../team/team-manager.js";
import { MailboxSystem } from "../../team/mailbox-system.js";
import { MemberBackend } from "../../team/member-backend.js";

describe("MemberBackend", () => {
  let tmpDir: string;
  let manager: TeamManager;
  let mailbox: MailboxSystem;
  let backend: MemberBackend;

  beforeEach(async () => {
    const id = randomUUID().slice(0, 8);
    tmpDir = join(tmpdir(), `codia-test-mb-${id}`);
    mkdirSync(tmpDir, { recursive: true });
    manager = new TeamManager(tmpDir);
    await manager.createTeam("test-team", "lead1");

    const teamDir = join(tmpDir, "test-team");
    mailbox = MailboxSystem.fromTeamDir(teamDir);
    // 注册 lead，以便降级通知可以发送
    await mailbox.registerMember("lead1");
    backend = new MemberBackend(manager, mailbox);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("detectAvailable", () => {
    it("返回 tmux 或 in-process", () => {
      const result = backend.detectAvailable();
      expect(["tmux", "in-process"]).toContain(result);
    });
  });

  describe("isTmuxAvailable", () => {
    it("返回布尔值", () => {
      expect(typeof backend.isTmuxAvailable()).toBe("boolean");
    });
  });

  describe("spawnMember", () => {
    it("创建 worktree 并设置 sessionId", async () => {
      const workDir = join(tmpDir, "w1");
      mkdirSync(workDir, { recursive: true });

      // 先添加成员到小组
      await manager.addMember("test-team", {
        name: "worker1",
        role: "worker",
        workDir,
        backend: "in-process",
        requiresApproval: false,
        status: "idle",
        contextDir: join(workDir, ".codia"),
        sessionId: null,
      });

      const result = await backend.spawnMember("test-team", {
        name: "worker1",
        role: "worker",
        workDir,
        backend: "in-process",
        requiresApproval: false,
        status: "idle",
        contextDir: join(workDir, ".codia"),
        sessionId: null,
      });

      expect(result.memberName).toBe("worker1");
      expect(result.sessionId).toBeTruthy();
      expect(result.workDir).toBe(workDir);

      // 成员状态已更新
      const team = await manager.loadTeam("test-team");
      const member = team.members.find((m) => m.name === "worker1");
      expect(member).toBeTruthy();
      expect(member!.status).toBe("active");
    });

    it("降级通知发送给 Lead", async () => {
      const workDir = join(tmpDir, "w1");
      mkdirSync(workDir, { recursive: true });

      // 先添加成员到小组
      await manager.addMember("test-team", {
        name: "worker1",
        role: "worker",
        workDir,
        backend: "in-process",
        requiresApproval: false,
        status: "idle",
        contextDir: join(workDir, ".codia"),
        sessionId: null,
      });

      const result = await backend.spawnMember("test-team", {
        name: "worker1",
        role: "worker",
        workDir,
        backend: "in-process",
        requiresApproval: false,
        status: "idle",
        contextDir: join(workDir, ".codia"),
        sessionId: null,
      });

      // 如果 tmux 不可用（CI 环境），应有降级通知
      if (result.degraded) {
        const leadInbox = await mailbox.readInbox("lead1");
        const degradedNotice = leadInbox.find(
          (m) => m.body.includes("backend_degraded"),
        );
        expect(degradedNotice).toBeTruthy();
      }
    });
  });

  describe("wakeMember", () => {
    it("不存在的成员抛错", async () => {
      await expect(
        backend.wakeMember("test-team", "nonexistent"),
      ).rejects.toThrow("不存在");
    });
  });
});
