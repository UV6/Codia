import type { BackgroundTask, SubAgentResult } from "./types.js";

// TaskManager —— 后台任务管理器，追踪子 Agent 生命周期
export class TaskManager {
  private tasks = new Map<string, BackgroundTask>();
  private completeCallbacks: Array<(task: BackgroundTask) => void> = [];

  // create —— 创建任务记录，返回 taskId
  create(description: string, type: string): string {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const task: BackgroundTask = {
      id: taskId,
      status: "running",
      type,
      description,
      startTime: new Date().toISOString(),
    };

    this.tasks.set(taskId, task);
    return taskId;
  }

  // update —— 更新任务状态和结果
  update(taskId: string, result: SubAgentResult): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskManager] 任务 ${taskId} 不存在`);
      return;
    }

    // status 映射：SubAgentResult.status → BackgroundTask.status
    const statusMap: Record<string, BackgroundTask["status"]> = {
      completed: "completed",
      failed: "failed",
      max_rounds: "completed",
      cancelled: "failed",
    };

    task.status = statusMap[result.status] ?? "failed";
    task.result = result;

    // 触发完成回调
    if (task.status === "completed" || task.status === "failed") {
      for (const cb of this.completeCallbacks) {
        try {
          cb(task);
        } catch {
          // 回调异常不影响
        }
      }
    }
  }

  // list —— 返回所有任务
  list(): BackgroundTask[] {
    return Array.from(this.tasks.values());
  }

  // get —— 按 ID 查找
  get(taskId: string): BackgroundTask | null {
    return this.tasks.get(taskId) ?? null;
  }

  // cancelAll —— 取消所有运行中的任务
  cancelAll(): void {
    for (const task of this.tasks.values()) {
      if (task.status === "running") {
        task.status = "failed";
        if (!task.result) {
          task.result = {
            status: "cancelled",
            text: "任务被取消",
            usage: { inputTokens: 0, outputTokens: 0, model: "" },
            rounds: 0,
            toolCalls: 0,
          };
        }
      }
    }
  }

  // onComplete —— 注册完成回调（由 ChatService 层注册，用于注入通知）
  onComplete(callback: (task: BackgroundTask) => void): void {
    this.completeCallbacks.push(callback);
  }
}
