import type { Tool, ToolContext, ToolResult, ToolInputSchema } from "../tool/types.js";
import type { TaskManager } from "./task-manager.js";

// TaskListTool —— 列出当前所有后台任务及其状态
class TaskListTool implements Tool {
  readonly name = "TaskList";
  readonly description = "列出当前所有后台任务及其状态";
  readonly type = "search" as const;
  readonly readOnly = true;
  readonly destructive = false;

  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {},
  };

  constructor(private taskManager: TaskManager) {}

  async execute(_params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const tasks = this.taskManager.list();
    const result = {
      tasks: tasks.map((t) => ({
        id: t.id,
        status: t.status,
        type: t.type,
        description: t.description,
        startTime: t.startTime,
        hasResult: t.result !== undefined,
      })),
    };
    return {
      status: "success",
      content: JSON.stringify(result, null, 2),
    };
  }
}

// TaskGetTool —— 按任务 ID 获取单个任务的详细信息
class TaskGetTool implements Tool {
  readonly name = "TaskGet";
  readonly description = "按任务 ID 获取单个任务的详细信息（含结果）";
  readonly type = "search" as const;
  readonly readOnly = true;
  readonly destructive = false;

  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "任务 ID",
      },
    },
    required: ["taskId"],
  };

  constructor(private taskManager: TaskManager) {}

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const taskId = params.taskId as string;
    if (!taskId) {
      return { status: "error", content: "缺少必填参数 taskId" };
    }

    const task = this.taskManager.get(taskId);
    if (!task) {
      return { status: "error", content: `任务 ${taskId} 不存在` };
    }

    return {
      status: "success",
      content: JSON.stringify(task, null, 2),
    };
  }
}

// TaskCreateTool —— 创建一个追踪条目
class TaskCreateTool implements Tool {
  readonly name = "TaskCreate";
  readonly description = "创建一个任务追踪条目（供系统内部使用）";
  readonly type = "search" as const;
  readonly readOnly = false;
  readonly destructive = false;

  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      subject: {
        type: "string",
        description: "任务标题（简短）",
      },
      description: {
        type: "string",
        description: "任务描述",
      },
    },
    required: ["subject", "description"],
  };

  constructor(private taskManager: TaskManager) {}

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const subject = params.subject as string;
    const description = params.description as string;
    if (!subject || !description) {
      return { status: "error", content: "缺少必填参数 subject 或 description" };
    }

    const taskId = this.taskManager.create(description, subject);

    return {
      status: "success",
      content: JSON.stringify({ taskId, subject }, null, 2),
    };
  }
}

// TaskUpdateTool —— 更新任务状态
class TaskUpdateTool implements Tool {
  readonly name = "TaskUpdate";
  readonly description = "更新任务状态（标记完成/失败）";
  readonly type = "search" as const;
  readonly readOnly = false;
  readonly destructive = false;

  readonly inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "任务 ID",
      },
      status: {
        type: "string",
        description: "新状态",
        enum: ["completed", "failed"],
      },
    },
    required: ["taskId", "status"],
  };

  constructor(private taskManager: TaskManager) {}

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const taskId = params.taskId as string;
    const status = params.status as string;
    if (!taskId || !status) {
      return { status: "error", content: "缺少必填参数 taskId 或 status" };
    }

    if (status !== "completed" && status !== "failed") {
      return { status: "error", content: "status 只能是 completed 或 failed" };
    }

    // TaskUpdate 创建一个轻量结果
    this.taskManager.update(taskId, {
      status: status as "completed" | "failed",
      text: `任务状态已更新为 ${status}`,
      usage: { inputTokens: 0, outputTokens: 0, model: "" },
      rounds: 0,
      toolCalls: 0,
    });

    return {
      status: "success",
      content: JSON.stringify({ taskId, status: `${status}` }, null, 2),
    };
  }
}

// createTaskTools —— 创建四个任务管理工具的工厂函数
export function createTaskTools(taskManager: TaskManager): Tool[] {
  return [
    new TaskListTool(taskManager),
    new TaskGetTool(taskManager),
    new TaskCreateTool(taskManager),
    new TaskUpdateTool(taskManager),
  ];
}
