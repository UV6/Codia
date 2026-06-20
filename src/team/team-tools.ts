import type { Tool, ToolContext, ToolResult, ToolInputSchema } from "../tool/types.js";
import type { SharedTaskBoard } from "./shared-task-board.js";
import type { MailboxSystem } from "./mailbox-system.js";
import type { MemberBackend } from "./member-backend.js";
import type { LeadOrchestrator } from "./lead-orchestrator.js";

// ── 工具 1: TeamTaskList ──
class TeamTaskListTool implements Tool {
  readonly name = "TeamTaskList";
  readonly description = "列出共享任务板上的所有任务，可按状态或负责人过滤";
  readonly type = "search" as const;
  readonly readOnly = true;
  readonly destructive = false;
  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      status: { type: "string", description: "按状态过滤 (pending/in_progress/completed/failed)" },
      assignee: { type: "string", description: "按负责人名称过滤" },
    },
  };

  constructor(private taskBoard: SharedTaskBoard) {}

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const tasks = await this.taskBoard.listTasks({
      status: params.status as string | undefined,
      assignee: params.assignee as string | undefined,
    });
    return { status: "success", content: JSON.stringify(tasks, null, 2) };
  }
}

// ── 工具 2: TeamTaskGet ──
class TeamTaskGetTool implements Tool {
  readonly name = "TeamTaskGet";
  readonly description = "按 ID 获取单个共享任务的详细信息";
  readonly type = "search" as const;
  readonly readOnly = true;
  readonly destructive = false;
  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: { taskId: { type: "string", description: "任务 ID" } },
    required: ["taskId"],
  };

  constructor(private taskBoard: SharedTaskBoard) {}

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const task = await this.taskBoard.getTask(params.taskId as string);
    if (!task) return { status: "error", content: `任务 "${params.taskId}" 不存在` };
    return { status: "success", content: JSON.stringify(task, null, 2) };
  }
}

// ── 工具 3: TeamTaskCreate ──
class TeamTaskCreateTool implements Tool {
  readonly name = "TeamTaskCreate";
  readonly description = "在共享任务板上创建新任务（仅 Lead 可用）";
  readonly type = "search" as const;
  readonly readOnly = false;
  readonly destructive = false;
  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      title: { type: "string", description: "任务标题" },
      description: { type: "string", description: "任务描述" },
      assignee: { type: "string", description: "负责人名称（可选）" },
      dependencies: { type: "string", description: "逗号分隔的依赖任务 ID 列表" },
    },
    required: ["title", "description"],
  };

  constructor(
    private taskBoard: SharedTaskBoard,
    private isLead: boolean,
  ) {}

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    if (!this.isLead) {
      return { status: "error", content: "仅 Lead 可以创建任务" };
    }
    const depsStr = (params.dependencies as string) || "";
    const dependencies = depsStr ? depsStr.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const task = await this.taskBoard.createTask({
      title: params.title as string,
      description: params.description as string,
      status: "pending",
      assignee: (params.assignee as string) || null,
      dependencies,
    });
    return { status: "success", content: JSON.stringify(task, null, 2) };
  }
}

// ── 工具 4: TeamTaskUpdate ──
class TeamTaskUpdateTool implements Tool {
  readonly name = "TeamTaskUpdate";
  readonly description = "更新共享任务的状态、负责人或依赖";
  readonly type = "search" as const;
  readonly readOnly = false;
  readonly destructive = false;
  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      taskId: { type: "string", description: "任务 ID" },
      status: { type: "string", description: "新状态", enum: ["pending", "in_progress", "completed", "failed"] },
      assignee: { type: "string", description: "新负责人名称" },
    },
    required: ["taskId"],
  };

  constructor(private taskBoard: SharedTaskBoard) {}

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    try {
      const patch: Record<string, unknown> = {};
      if (params.status) patch.status = params.status;
      if (params.assignee) patch.assignee = params.assignee;
      const task = await this.taskBoard.updateTask(params.taskId as string, patch);
      return { status: "success", content: JSON.stringify(task, null, 2) };
    } catch (e) {
      return { status: "error", content: (e as Error).message };
    }
  }
}

// ── 工具 5: TeamTaskDelete ──
class TeamTaskDeleteTool implements Tool {
  readonly name = "TeamTaskDelete";
  readonly description = "从共享任务板删除任务（仅 Lead 可用）";
  readonly type = "search" as const;
  readonly readOnly = false;
  readonly destructive = true;
  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: { taskId: { type: "string", description: "任务 ID" } },
    required: ["taskId"],
  };

  constructor(
    private taskBoard: SharedTaskBoard,
    private isLead: boolean,
  ) {}

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    if (!this.isLead) {
      return { status: "error", content: "仅 Lead 可以删除任务" };
    }
    try {
      await this.taskBoard.deleteTask(params.taskId as string);
      return { status: "success", content: `任务 "${params.taskId}" 已删除` };
    } catch (e) {
      return { status: "error", content: (e as Error).message };
    }
  }
}

// ── 工具 6: SendMessage ──
class SendMessageTool implements Tool {
  readonly name = "SendMessage";
  readonly description = "向小组内指定成员发送点对点消息";
  readonly type = "search" as const;
  readonly readOnly = false;
  readonly destructive = false;
  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      to: { type: "string", description: "收件人名称" },
      body: { type: "string", description: "消息正文" },
      summary: { type: "string", description: "消息摘要" },
    },
    required: ["to", "body", "summary"],
  };

  constructor(
    private mailbox: MailboxSystem,
    private memberName: string,
  ) {}

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const msg = await this.mailbox.sendMessage({
      from: this.memberName,
      to: params.to as string,
      type: "text",
      body: params.body as string,
      summary: params.summary as string,
    });
    return { status: "success", content: JSON.stringify(msg, null, 2) };
  }
}

// ── 工具 7: BroadcastMessage ──
class BroadcastMessageTool implements Tool {
  readonly name = "BroadcastMessage";
  readonly description = "向小组所有成员发送广播消息（仅 Lead 可用）";
  readonly type = "search" as const;
  readonly readOnly = false;
  readonly destructive = false;
  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      body: { type: "string", description: "消息正文" },
      summary: { type: "string", description: "消息摘要" },
    },
    required: ["body", "summary"],
  };

  constructor(
    private mailbox: MailboxSystem,
    private memberName: string,
    private isLead: boolean,
  ) {}

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    if (!this.isLead) {
      return { status: "error", content: "仅 Lead 可以发送广播" };
    }
    const msgs = await this.mailbox.broadcast(
      this.memberName,
      params.body as string,
      params.summary as string,
    );
    return { status: "success", content: JSON.stringify(msgs, null, 2) };
  }
}

// ── 工具 8: ReadInbox ──
class ReadInboxTool implements Tool {
  readonly name = "ReadInbox";
  readonly description = "读取自己的收件箱，可选择标记已读";
  readonly type = "search" as const;
  readonly readOnly = false;
  readonly destructive = false;
  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      markAsRead: { type: "boolean", description: "是否标记为已读（默认 false）" },
    },
  };

  constructor(
    private mailbox: MailboxSystem,
    private memberName: string,
  ) {}

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const markAsRead = params.markAsRead === true;
    const messages = await this.mailbox.readInbox(this.memberName, markAsRead);
    return { status: "success", content: JSON.stringify(messages, null, 2) };
  }
}

// ── 工具 9: RequestApproval ──
class RequestApprovalTool implements Tool {
  readonly name = "RequestApproval";
  readonly description = "向 Lead 发送审批请求（需要审批的成员使用）";
  readonly type = "search" as const;
  readonly readOnly = false;
  readonly destructive = false;
  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      plan: { type: "string", description: "执行计划的描述" },
      planId: { type: "string", description: "计划 ID（用于追踪" },
    },
    required: ["plan", "planId"],
  };

  constructor(
    private mailbox: MailboxSystem,
    private memberName: string,
    private leadName: string,
  ) {}

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const msg = await this.mailbox.sendMessage({
      from: this.memberName,
      to: this.leadName,
      type: "approval_request",
      body: JSON.stringify({
        plan: params.plan,
        planId: params.planId,
        requester: this.memberName,
      }),
      summary: `审批请求: ${(params.plan as string).slice(0, 50)}...`,
    });
    return { status: "success", content: JSON.stringify(msg, null, 2) };
  }
}

// ── 工具 10: StopMember ──
class StopMemberTool implements Tool {
  readonly name = "StopMember";
  readonly description = "终止指定成员（仅 Lead 可用）";
  readonly type = "search" as const;
  readonly readOnly = false;
  readonly destructive = true;
  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      memberName: { type: "string", description: "要终止的成员名称" },
      teamName: { type: "string", description: "小组名称" },
    },
    required: ["memberName", "teamName"],
  };

  constructor(
    private memberBackend: MemberBackend | undefined,
    private isLead: boolean,
  ) {}

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    if (!this.isLead) {
      return { status: "error", content: "仅 Lead 可以终止成员" };
    }
    if (!this.memberBackend) {
      return { status: "error", content: "MemberBackend 未初始化" };
    }
    try {
      await this.memberBackend.stopMember(
        params.teamName as string,
        params.memberName as string,
      );
      return { status: "success", content: `成员 "${params.memberName}" 已终止` };
    } catch (e) {
      return { status: "error", content: (e as Error).message };
    }
  }
}

// ── 工具 11: MergeWorktrees ──
class MergeWorktreesTool implements Tool {
  readonly name = "MergeWorktrees";
  readonly description = "合并小组所有成员的工作目录（仅 Lead 可用）";
  readonly type = "shell" as const;
  readonly readOnly = false;
  readonly destructive = false;
  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      teamName: { type: "string", description: "小组名称" },
    },
    required: ["teamName"],
  };

  constructor(
    private orchestrator: LeadOrchestrator | undefined,
    private isLead: boolean,
  ) {}

  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    if (!this.isLead) {
      return { status: "error", content: "仅 Lead 可以执行合并" };
    }
    if (!this.orchestrator) {
      return { status: "error", content: "LeadOrchestrator 未初始化" };
    }
    try {
      const results = await this.orchestrator.mergeAllWorktrees(params.teamName as string);
      return { status: "success", content: JSON.stringify(results, null, 2) };
    } catch (e) {
      return { status: "error", content: (e as Error).message };
    }
  }
}

// ── createTeamTools —— 创建小组协作工具集的工厂函数 ──
export function createTeamTools(
  taskBoard: SharedTaskBoard,
  mailbox: MailboxSystem,
  memberName: string,
  isLead: boolean,
  leadName: string,
  memberBackend?: MemberBackend,
  orchestrator?: LeadOrchestrator,
): Tool[] {
  return [
    new TeamTaskListTool(taskBoard),
    new TeamTaskGetTool(taskBoard),
    new TeamTaskCreateTool(taskBoard, isLead),
    new TeamTaskUpdateTool(taskBoard),
    new TeamTaskDeleteTool(taskBoard, isLead),
    new SendMessageTool(mailbox, memberName),
    new BroadcastMessageTool(mailbox, memberName, isLead),
    new ReadInboxTool(mailbox, memberName),
    new RequestApprovalTool(mailbox, memberName, leadName),
    new StopMemberTool(memberBackend, isLead),
    new MergeWorktreesTool(orchestrator, isLead),
  ];
}
