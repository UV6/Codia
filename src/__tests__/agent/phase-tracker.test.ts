import { describe, it, expect } from "vitest";
import { parsePlanPhases, advancePhases, completePhases } from "../../agent/phase-tracker.js";

describe("phase-tracker", () => {
  it("从可见计划中提取多个阶段", () => {
    const phases = parsePlanPhases(`计划：
1. 搜索相关代码
2. 修改实现
3. 运行测试`);

    expect(phases).toHaveLength(3);
    expect(phases[0].title).toBe("搜索相关代码");
    expect(phases[0].status).toBe("in_progress");
    expect(phases[1].status).toBe("pending");
  });

  it("简单任务不创建阶段", () => {
    expect(parsePlanPhases("先看看情况")).toEqual([]);
    expect(parsePlanPhases("计划：\n1. 只做一件事")).toEqual([]);
    expect(parsePlanPhases("计划：\n1. 看代码\n2. 改一下")).toEqual([]);
  });

  it("多个任务的计划会按任务标题分组", () => {
    const phases = parsePlanPhases(`计划：
任务 1：外卖系统
1. 写简单实施计划
2. 保存到 docs/

任务 2：电商系统
1. 写简单实施计划
2. 保存到 docs/`);

    expect(phases).toHaveLength(4);
    expect(phases[0].taskTitle).toBe("外卖系统");
    expect(phases[2].taskTitle).toBe("电商系统");
  });

  it("推进阶段会完成当前项并激活下一项", () => {
    const phases = parsePlanPhases(`计划：
1. 搜索相关代码
2. 修改实现
3. 运行测试`);

    const advanced = advancePhases(phases);
    expect(advanced[0].status).toBe("completed");
    expect(advanced[1].status).toBe("in_progress");
    expect(advanced[2].status).toBe("pending");
  });

  it("完成阶段会把剩余项都标记为 completed", () => {
    const phases = parsePlanPhases(`计划：
1. 搜索相关代码
2. 修改实现
3. 运行测试`);

    const completed = completePhases(phases);
    expect(completed.every((phase) => phase.status === "completed")).toBe(true);
  });
});
