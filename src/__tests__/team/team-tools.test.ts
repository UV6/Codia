import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SharedTaskBoard } from "../../team/shared-task-board.js";
import { MailboxSystem } from "../../team/mailbox-system.js";
import { createTeamTools } from "../../team/team-tools.js";
import type { Tool } from "../../tool/types.js";

describe("TeamTools", () => {
  let tmpDir: string;
  let taskBoard: SharedTaskBoard;
  let mailbox: MailboxSystem;
  const memberName = "worker1";
  const leadName = "lead1";
  const ctx = { cwd: "/tmp", signal: new AbortController().signal };

  function getTool(tools: Tool[], name: string): Tool | undefined {
    return tools.find((t) => t.name === name);
  }

  beforeEach(async () => {
    const id = randomUUID().slice(0, 8);
    tmpDir = join(tmpdir(), `codia-test-tools-${id}`);
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(join(tmpDir, "members", "mailbox"), { recursive: true });

    taskBoard = new SharedTaskBoard(tmpDir);
    mailbox = MailboxSystem.fromTeamDir(tmpDir);
    await mailbox.registerMember(memberName);
    await mailbox.registerMember(leadName);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("TeamTaskListTool", () => {
    it("返回任务列表", async () => {
      const tools = createTeamTools(taskBoard, mailbox, memberName, false, leadName);
      const tool = getTool(tools, "TeamTaskList")!;
      const result = await tool.execute({}, ctx);
      expect(result.status).toBe("success");
      const parsed = JSON.parse(result.content);
      expect(Array.isArray(parsed)).toBe(true);
    });
  });

  describe("TeamTaskCreateTool", () => {
    it("Lead 调用成功", async () => {
      const tools = createTeamTools(taskBoard, mailbox, leadName, true, leadName);
      const tool = getTool(tools, "TeamTaskCreate")!;
      const result = await tool.execute({
        title: "测试任务",
        description: "测试描述",
      }, ctx);
      expect(result.status).toBe("success");
      const parsed = JSON.parse(result.content);
      expect(parsed.title).toBe("测试任务");
    });

    it("非 Lead 返回 error", async () => {
      const tools = createTeamTools(taskBoard, mailbox, memberName, false, leadName);
      const tool = getTool(tools, "TeamTaskCreate")!;
      const result = await tool.execute({ title: "x", description: "y" }, ctx);
      expect(result.status).toBe("error");
    });
  });

  describe("TeamTaskUpdateTool", () => {
    it("更新状态成功", async () => {
      const task = await taskBoard.createTask({
        title: "T1", description: "d", status: "pending", assignee: null, dependencies: [],
      });
      const tools = createTeamTools(taskBoard, mailbox, memberName, false, leadName);
      const tool = getTool(tools, "TeamTaskUpdate")!;
      const result = await tool.execute({ taskId: task.id, status: "in_progress" }, ctx);
      expect(result.status).toBe("success");
      const updated = JSON.parse(result.content);
      expect(updated.status).toBe("in_progress");
    });
  });

  describe("TeamTaskDeleteTool", () => {
    it("Lead 调用成功", async () => {
      const task = await taskBoard.createTask({
        title: "T1", description: "d", status: "pending", assignee: null, dependencies: [],
      });
      const tools = createTeamTools(taskBoard, mailbox, leadName, true, leadName);
      const tool = getTool(tools, "TeamTaskDelete")!;
      const result = await tool.execute({ taskId: task.id }, ctx);
      expect(result.status).toBe("success");
    });

    it("非 Lead 返回 error", async () => {
      const task = await taskBoard.createTask({
        title: "T1", description: "d", status: "pending", assignee: null, dependencies: [],
      });
      const tools = createTeamTools(taskBoard, mailbox, memberName, false, leadName);
      const tool = getTool(tools, "TeamTaskDelete")!;
      const result = await tool.execute({ taskId: task.id }, ctx);
      expect(result.status).toBe("error");
    });
  });

  describe("SendMessageTool", () => {
    it("发送消息成功", async () => {
      const tools = createTeamTools(taskBoard, mailbox, memberName, false, leadName);
      const tool = getTool(tools, "SendMessage")!;
      const result = await tool.execute({
        to: leadName,
        body: "Hello Lead",
        summary: "Greeting",
      }, ctx);
      expect(result.status).toBe("success");
      const parsed = JSON.parse(result.content);
      expect(parsed.from).toBe(memberName);
      expect(parsed.to).toBe(leadName);
    });
  });

  describe("BroadcastMessageTool", () => {
    it("Lead 可发送广播", async () => {
      const tools = createTeamTools(taskBoard, mailbox, leadName, true, leadName);
      const tool = getTool(tools, "BroadcastMessage")!;
      const result = await tool.execute({
        body: "announcement",
        summary: "重要",
      }, ctx);
      expect(result.status).toBe("success");
    });

    it("非 Lead 返回 error", async () => {
      const tools = createTeamTools(taskBoard, mailbox, memberName, false, leadName);
      const tool = getTool(tools, "BroadcastMessage")!;
      const result = await tool.execute({ body: "x", summary: "y" }, ctx);
      expect(result.status).toBe("error");
    });
  });

  describe("ReadInboxTool", () => {
    it("返回收件箱", async () => {
      await mailbox.sendMessage({
        from: leadName, to: memberName, type: "text", body: "msg", summary: "s",
      });
      const tools = createTeamTools(taskBoard, mailbox, memberName, false, leadName);
      const tool = getTool(tools, "ReadInbox")!;
      const result = await tool.execute({}, ctx);
      expect(result.status).toBe("success");
      const parsed = JSON.parse(result.content);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("RequestApprovalTool", () => {
    it("发送审批请求给 Lead", async () => {
      const tools = createTeamTools(taskBoard, mailbox, memberName, false, leadName);
      const tool = getTool(tools, "RequestApproval")!;
      const result = await tool.execute({
        plan: "我要修改 auth 模块",
        planId: "plan-001",
      }, ctx);
      expect(result.status).toBe("success");
      // Lead 应收到了审批请求
      const leadInbox = await mailbox.readInbox(leadName);
      const request = leadInbox.find((m) => m.type === "approval_request");
      expect(request).toBeTruthy();
      expect(request!.from).toBe(memberName);
    });
  });

  describe("StopMemberTool", () => {
    it("非 Lead 返回 error", async () => {
      const tools = createTeamTools(taskBoard, mailbox, memberName, false, leadName);
      const tool = getTool(tools, "StopMember")!;
      const result = await tool.execute({
        memberName: "w1",
        teamName: "test",
      }, ctx);
      expect(result.status).toBe("error");
    });
  });

  describe("MergeWorktreesTool", () => {
    it("非 Lead 返回 error", async () => {
      const tools = createTeamTools(taskBoard, mailbox, memberName, false, leadName);
      const tool = getTool(tools, "MergeWorktrees")!;
      const result = await tool.execute({ teamName: "test" }, ctx);
      expect(result.status).toBe("error");
    });
  });

  describe("inputSchema", () => {
    it("所有工具都有 inputSchema", () => {
      const tools = createTeamTools(taskBoard, mailbox, memberName, false, leadName);
      expect(tools.length).toBe(11);
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });
  });
});
