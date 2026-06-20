import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { TeamManager } from "../../team/team-manager.js";

describe("TeamManager", () => {
  let rootDir: string;
  let manager: TeamManager;

  beforeEach(() => {
    const id = randomUUID().slice(0, 8);
    rootDir = join(tmpdir(), `codia-test-team-${id}`);
    mkdirSync(rootDir, { recursive: true });
    manager = new TeamManager(rootDir);
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  describe("createTeam", () => {
    it("创建后目录和 group.json 存在", async () => {
      await manager.createTeam("test-team", "lead1");
      const dir = join(rootDir, "test-team");
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, "group.json"))).toBe(true);
      expect(existsSync(join(dir, "members", "mailbox"))).toBe(true);
    });

    it("创建的 group.json 内容正确", async () => {
      const config = await manager.createTeam("test-team", "lead1");
      expect(config.name).toBe("test-team");
      expect(config.lead).toBe("lead1");
      expect(config.members).toEqual([]);
      expect(config.createdAt).toBeTruthy();
      expect(config.updatedAt).toBeTruthy();
    });
  });

  describe("loadTeam", () => {
    it("创建后加载，验证字段一致", async () => {
      const created = await manager.createTeam("my-team", "lead1");
      const loaded = await manager.loadTeam("my-team");
      expect(loaded.name).toBe(created.name);
      expect(loaded.lead).toBe(created.lead);
      expect(loaded.createdAt).toBe(created.createdAt);
    });

    it("不存在时抛错", async () => {
      await expect(manager.loadTeam("nonexistent")).rejects.toThrow("小组");
    });
  });

  describe("listTeams", () => {
    it("列出多个小组名称", async () => {
      await manager.createTeam("team-a", "lead1");
      await manager.createTeam("team-b", "lead2");
      const names = await manager.listTeams();
      expect(names).toContain("team-a");
      expect(names).toContain("team-b");
      expect(names.length).toBe(2);
    });

    it("空目录下列出空列表", async () => {
      const names = await manager.listTeams();
      expect(names).toEqual([]);
    });
  });

  describe("addMember / removeMember", () => {
    it("成员正确增删", async () => {
      await manager.createTeam("test-team", "lead1");
      await manager.addMember("test-team", {
        name: "worker1",
        role: "worker",
        workDir: "/tmp/w1",
        backend: "in-process",
        requiresApproval: false,
        status: "idle",
        contextDir: "/tmp/w1/.codia",
        sessionId: null,
      });
      let team = await manager.loadTeam("test-team");
      expect(team.members.length).toBe(1);
      expect(team.members[0].name).toBe("worker1");

      await manager.removeMember("test-team", "worker1");
      team = await manager.loadTeam("test-team");
      expect(team.members.length).toBe(0);
    });

    it("重名成员抛错", async () => {
      await manager.createTeam("test-team", "lead1");
      const info = {
        name: "worker1",
        role: "worker" as const,
        workDir: "/tmp/w1",
        backend: "in-process" as const,
        requiresApproval: false,
        status: "idle" as const,
        contextDir: "/tmp/w1/.codia",
        sessionId: null,
      };
      await manager.addMember("test-team", info);
      await expect(manager.addMember("test-team", info)).rejects.toThrow("已存在");
    });
  });

  describe("updateMemberStatus", () => {
    it("状态变更落盘", async () => {
      await manager.createTeam("test-team", "lead1");
      await manager.addMember("test-team", {
        name: "worker1",
        role: "worker",
        workDir: "/tmp/w1",
        backend: "in-process",
        requiresApproval: false,
        status: "idle",
        contextDir: "/tmp/w1/.codia",
        sessionId: null,
      });
      await manager.updateMemberStatus("test-team", "worker1", "active");
      const team = await manager.loadTeam("test-team");
      expect(team.members[0].status).toBe("active");
    });

    it("不存在的成员抛错", async () => {
      await manager.createTeam("test-team", "lead1");
      await expect(
        manager.updateMemberStatus("test-team", "nobody", "active"),
      ).rejects.toThrow("不存在");
    });
  });

  describe("saveTeam / deleteTeam", () => {
    it("saveTeam 更新 updatedAt", async () => {
      const config = await manager.createTeam("test-team", "lead1");
      const oldUpdatedAt = config.updatedAt;
      await new Promise((r) => setTimeout(r, 10)); // 等一点时间确保时间戳不同
      await manager.saveTeam(config);
      const reloaded = await manager.loadTeam("test-team");
      expect(reloaded.updatedAt).not.toBe(oldUpdatedAt);
    });

    it("deleteTeam 删除后目录不存在", async () => {
      await manager.createTeam("test-team", "lead1");
      await manager.deleteTeam("test-team");
      expect(existsSync(join(rootDir, "test-team"))).toBe(false);
    });
  });

  describe("updateMember", () => {
    it("更新多个成员属性", async () => {
      await manager.createTeam("test-team", "lead1");
      await manager.addMember("test-team", {
        name: "worker1",
        role: "worker",
        workDir: "/tmp/w1",
        backend: "in-process",
        requiresApproval: false,
        status: "idle",
        contextDir: "/tmp/w1/.codia",
        sessionId: null,
      });
      await manager.updateMember("test-team", "worker1", {
        status: "active",
        sessionId: "tmux-sess-1",
      });
      const team = await manager.loadTeam("test-team");
      expect(team.members[0].status).toBe("active");
      expect(team.members[0].sessionId).toBe("tmux-sess-1");
    });
  });
});
