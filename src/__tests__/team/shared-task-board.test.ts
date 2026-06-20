import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SharedTaskBoard } from "../../team/shared-task-board.js";

describe("SharedTaskBoard", () => {
  let tmpDir: string;
  let board: SharedTaskBoard;

  beforeEach(() => {
    const id = randomUUID().slice(0, 8);
    tmpDir = join(tmpdir(), `codia-test-board-${id}`);
    mkdirSync(tmpDir, { recursive: true });
    board = new SharedTaskBoard(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createTask", () => {
    it("创建后返回含 id 和 timestamp 的完整任务", async () => {
      const task = await board.createTask({
        title: "测试任务",
        description: "测试描述",
        status: "pending",
        assignee: null,
        dependencies: [],
      });
      expect(task.id).toBeTruthy();
      expect(task.title).toBe("测试任务");
      expect(task.createdAt).toBeTruthy();
      expect(task.updatedAt).toBeTruthy();
      expect(task.status).toBe("pending");
    });
  });

  describe("getTask", () => {
    it("按 id 查询", async () => {
      const created = await board.createTask({
        title: "T1",
        description: "desc",
        status: "pending",
        assignee: null,
        dependencies: [],
      });
      const found = await board.getTask(created.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe("T1");
    });

    it("不存在返回 null", async () => {
      const found = await board.getTask("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("listTasks", () => {
    it("按 status 过滤", async () => {
      await board.createTask({
        title: "T1", description: "d", status: "pending", assignee: null, dependencies: [],
      });
      await board.createTask({
        title: "T2", description: "d", status: "completed", assignee: null, dependencies: [],
      });
      await board.createTask({
        title: "T3", description: "d", status: "pending", assignee: null, dependencies: [],
      });

      const pending = await board.listTasks({ status: "pending" });
      expect(pending.length).toBe(2);

      const completed = await board.listTasks({ status: "completed" });
      expect(completed.length).toBe(1);
    });

    it("按 assignee 过滤", async () => {
      await board.createTask({
        title: "T1", description: "d", status: "pending", assignee: "alice", dependencies: [],
      });
      await board.createTask({
        title: "T2", description: "d", status: "pending", assignee: "bob", dependencies: [],
      });

      const aliceTasks = await board.listTasks({ assignee: "alice" });
      expect(aliceTasks.length).toBe(1);
      expect(aliceTasks[0].assignee).toBe("alice");
    });

    it("无过滤时返回全部", async () => {
      await board.createTask({
        title: "T1", description: "d", status: "pending", assignee: null, dependencies: [],
      });
      await board.createTask({
        title: "T2", description: "d", status: "completed", assignee: null, dependencies: [],
      });
      const all = await board.listTasks();
      expect(all.length).toBe(2);
    });
  });

  describe("updateTask", () => {
    it("更新状态后查询到变更", async () => {
      const created = await board.createTask({
        title: "T1", description: "d", status: "pending", assignee: null, dependencies: [],
      });
      const updated = await board.updateTask(created.id, { status: "in_progress" });
      expect(updated.status).toBe("in_progress");
      // updatedAt 至少不早于 createdAt（同一毫秒内可能相等）
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(created.updatedAt).getTime(),
      );

      const reloaded = await board.getTask(created.id);
      expect(reloaded!.status).toBe("in_progress");
    });

    it("更新 assignee", async () => {
      const created = await board.createTask({
        title: "T1", description: "d", status: "pending", assignee: null, dependencies: [],
      });
      const updated = await board.updateTask(created.id, { assignee: "worker1" });
      expect(updated.assignee).toBe("worker1");
    });

    it("不存在的任务抛错", async () => {
      await expect(
        board.updateTask("nonexistent", { status: "completed" }),
      ).rejects.toThrow("不存在");
    });
  });

  describe("deleteTask", () => {
    it("删除后查询返回 null", async () => {
      const created = await board.createTask({
        title: "T1", description: "d", status: "pending", assignee: null, dependencies: [],
      });
      await board.deleteTask(created.id);
      const found = await board.getTask(created.id);
      expect(found).toBeNull();
    });

    it("删除不存在的任务抛错", async () => {
      await expect(board.deleteTask("nonexistent")).rejects.toThrow("不存在");
    });
  });

  describe("getReadyTasks", () => {
    it("依赖已完成的任务出现在结果中", async () => {
      const dep = await board.createTask({
        title: "Dep", description: "d", status: "completed", assignee: null, dependencies: [],
      });
      const ready = await board.createTask({
        title: "Ready", description: "d", status: "pending", assignee: null, dependencies: [dep.id],
      });
      const notReady = await board.createTask({
        title: "Not Ready", description: "d", status: "pending", assignee: null,
        dependencies: ["nonexistent"],
      });

      const readyTasks = await board.getReadyTasks();
      expect(readyTasks.map((t) => t.id)).toContain(ready.id);
      expect(readyTasks.map((t) => t.id)).not.toContain(notReady.id);
    });

    it("无依赖的 pending 任务也可执行", async () => {
      const task = await board.createTask({
        title: "T1", description: "d", status: "pending", assignee: null, dependencies: [],
      });
      const ready = await board.getReadyTasks();
      expect(ready.map((t) => t.id)).toContain(task.id);
    });
  });
});
