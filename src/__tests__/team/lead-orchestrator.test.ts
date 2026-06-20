import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { TeamManager } from "../../team/team-manager.js";
import { SharedTaskBoard } from "../../team/shared-task-board.js";
import { MailboxSystem } from "../../team/mailbox-system.js";
import { MemberBackend } from "../../team/member-backend.js";
import { LeadOrchestrator } from "../../team/lead-orchestrator.js";

describe("LeadOrchestrator", () => {
  let tmpDir: string;
  let teamDir: string;
  let manager: TeamManager;
  let taskBoard: SharedTaskBoard;
  let mailbox: MailboxSystem;
  let memberBackend: MemberBackend;
  let orchestrator: LeadOrchestrator;

  beforeEach(async () => {
    const id = randomUUID().slice(0, 8);
    tmpDir = join(tmpdir(), `codia-test-orch-${id}`);
    mkdirSync(tmpDir, { recursive: true });
    manager = new TeamManager(tmpDir);

    // 创建小组
    await manager.createTeam("test-team", "lead1");
    teamDir = join(tmpDir, "test-team");

    taskBoard = new SharedTaskBoard(teamDir);
    mailbox = MailboxSystem.fromTeamDir(teamDir);
    memberBackend = new MemberBackend(manager, mailbox);
    orchestrator = new LeadOrchestrator(
      manager,
      taskBoard,
      mailbox,
      memberBackend,
      tmpDir,
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("decomposeGoal", () => {
    it("输入目标文本，返回 SharedTask[] 且任务间有依赖关系", async () => {
      const tasks = await orchestrator.decomposeGoal(
        "实现用户登录。添加登录页面。添加后端验证。",
      );
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      expect(tasks[0].id).toBeTruthy();
      expect(tasks[0].title).toBeTruthy();
      // 第一个任务无依赖，后续任务依赖前一个
      expect(tasks[0].dependencies).toEqual([]);
      if (tasks.length > 1) {
        expect(tasks[1].dependencies).toContain(tasks[0].id);
      }
    });

    it("使用 providedTasks 时直接创建", async () => {
      const tasks = await orchestrator.decomposeGoal("", [
        { title: "T1", description: "d1", status: "pending" as const, assignee: null, dependencies: [] },
        { title: "T2", description: "d2", status: "pending" as const, assignee: null, dependencies: [] },
      ]);
      expect(tasks.length).toBe(2);
      expect(tasks[0].title).toBe("T1");
      expect(tasks[1].title).toBe("T2");
    });
  });

  describe("spawnMembersForTasks", () => {
    it("返回的 SpawnResult 数量等于任务数量", async () => {
      // 注册 lead 和 worker 邮箱
      await mailbox.registerMember("lead1");
      await mailbox.registerMember("w1");
      await mailbox.registerMember("w2");
      // 先添加 worker 成员
      const w1Dir = join(tmpDir, "w1");
      const w2Dir = join(tmpDir, "w2");
      mkdirSync(w1Dir, { recursive: true });
      mkdirSync(w2Dir, { recursive: true });
      await manager.addMember("test-team", {
        name: "w1", role: "worker", workDir: w1Dir,
        backend: "in-process", requiresApproval: false, status: "idle",
        contextDir: join(w1Dir, ".codia"), sessionId: null,
      });
      await manager.addMember("test-team", {
        name: "w2", role: "worker", workDir: w2Dir,
        backend: "in-process", requiresApproval: false, status: "idle",
        contextDir: join(w2Dir, ".codia"), sessionId: null,
      });

      const tasks = await orchestrator.decomposeGoal("", [
        { title: "T1", description: "d1", status: "pending" as const, assignee: null, dependencies: [] },
        { title: "T2", description: "d2", status: "pending" as const, assignee: null, dependencies: [] },
      ]);
      const results = await orchestrator.spawnMembersForTasks("test-team", tasks);
      expect(results.length).toBe(2);
      expect(results[0].memberName).toBe("w1");
      expect(results[1].memberName).toBe("w2");
    });
  });

  describe("rollbackMember", () => {
    it("标记成员为空闲", async () => {
      await manager.addMember("test-team", {
        name: "w1", role: "worker", workDir: join(tmpDir, "w1"),
        backend: "in-process", requiresApproval: false, status: "active",
        contextDir: join(tmpDir, "w1", ".codia"), sessionId: null,
      });
      await orchestrator.rollbackMember("test-team", "w1");
      const team = await manager.loadTeam("test-team");
      const w1 = team.members.find((m) => m.name === "w1");
      expect(w1!.status).toBe("idle");
    });
  });
});
