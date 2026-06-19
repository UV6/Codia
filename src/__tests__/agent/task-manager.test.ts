import { describe, it, expect, beforeEach } from "vitest";
import { TaskManager } from "../../agent/task-manager.js";
import type { SubAgentResult } from "../../agent/types.js";

function makeResult(overrides: Partial<SubAgentResult> = {}): SubAgentResult {
  return {
    status: "completed",
    text: "任务完成",
    usage: { inputTokens: 100, outputTokens: 50, model: "sonnet" },
    rounds: 3,
    toolCalls: 5,
    ...overrides,
  };
}

describe("TaskManager", () => {
  let manager: TaskManager;

  beforeEach(() => {
    manager = new TaskManager();
  });

  it("create 创建 running 状态的任务", () => {
    const taskId = manager.create("测试任务", "Explore");
    expect(taskId).toMatch(/^task-/);

    const list = manager.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(taskId);
    expect(list[0].status).toBe("running");
    expect(list[0].type).toBe("Explore");
    expect(list[0].description).toBe("测试任务");
    expect(list[0].startTime).toBeTruthy();
    expect(list[0].result).toBeUndefined();
  });

  it("get 按 ID 查找", () => {
    const taskId = manager.create("查找测试", "Plan");
    const task = manager.get(taskId);
    expect(task).not.toBeNull();
    expect(task!.id).toBe(taskId);
  });

  it("get 不存在返回 null", () => {
    expect(manager.get("nonexistent")).toBeNull();
  });

  it("update 更新状态为 completed", () => {
    const taskId = manager.create("完成测试", "fork");
    manager.update(taskId, makeResult());

    const task = manager.get(taskId);
    expect(task!.status).toBe("completed");
    expect(task!.result).toBeDefined();
    expect(task!.result!.status).toBe("completed");
    expect(task!.result!.text).toBe("任务完成");
  });

  it("update failed 状态", () => {
    const taskId = manager.create("失败测试", "Explore");
    manager.update(taskId, makeResult({ status: "failed", text: "执行出错" }));

    const task = manager.get(taskId);
    expect(task!.status).toBe("failed");
  });

  it("update max_rounds 映射为 completed", () => {
    const taskId = manager.create("轮次测试", "Explore");
    manager.update(taskId, makeResult({ status: "max_rounds", text: "超时" }));

    const task = manager.get(taskId);
    expect(task!.status).toBe("completed");
  });

  it("update cancelled 映射为 failed", () => {
    const taskId = manager.create("取消测试", "Explore");
    manager.update(taskId, makeResult({ status: "cancelled", text: "被取消" }));

    const task = manager.get(taskId);
    expect(task!.status).toBe("failed");
  });

  it("update 不存在的任务仅告警", () => {
    manager.update("nonexistent", makeResult());
    // 验证不抛异常
  });

  it("list 返回所有任务", () => {
    manager.create("任务1", "Explore");
    manager.create("任务2", "fork");
    expect(manager.list()).toHaveLength(2);
  });

  it("cancelAll 将所有 running 标记为 failed", () => {
    const id1 = manager.create("任务1", "Explore");
    const id2 = manager.create("任务2", "Plan");

    manager.cancelAll();

    const task1 = manager.get(id1);
    const task2 = manager.get(id2);
    expect(task1!.status).toBe("failed");
    expect(task1!.result!.text).toBe("任务被取消");
    expect(task2!.status).toBe("failed");
  });

  it("cancelAll 不影响已完成的", () => {
    const id = manager.create("完成", "Explore");
    manager.update(id, makeResult());
    expect(manager.get(id)!.status).toBe("completed");

    manager.cancelAll();
    expect(manager.get(id)!.status).toBe("completed");
  });

  it("onComplete 回调在任务完成时触发", () => {
    const completed: string[] = [];
    manager.onComplete((task) => {
      completed.push(task.id);
    });

    const id = manager.create("回调测试", "Explore");
    manager.update(id, makeResult());

    expect(completed).toContain(id);
  });
});
