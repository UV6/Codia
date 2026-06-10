import type { ToolCall, ToolContext } from "../tool/types.js";
import { executeTool } from "../tool/executor.js";
import type { ToolRegistry } from "../tool/registry.js";
import type { ScheduleResult } from "./types.js";

// ToolScheduler —— 按安全性分批执行工具调用
// destructive=false（只读）的工具并发执行（Promise.all）
// destructive=true（有副作用）的工具串行执行
// 结果按原始 ToolCall 顺序排列
export class ToolScheduler {
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async schedule(
    calls: ToolCall[],
    context: ToolContext,
  ): Promise<ScheduleResult[]> {
    if (calls.length === 0) return [];

    // 按 destructive 标签分两批，记录原始索引
    const safe: { call: ToolCall; index: number }[] = [];
    const unsafe: { call: ToolCall; index: number }[] = [];

    for (let i = 0; i < calls.length; i++) {
      const tool = this.registry.get(calls[i].name);
      if (tool?.destructive) {
        unsafe.push({ call: calls[i], index: i });
      } else {
        safe.push({ call: calls[i], index: i });
      }
    }

    // 并发执行只读工具
    const safeResults = await Promise.all(
      safe.map(async ({ call, index }) => {
        const { result } = await executeTool(call, context, this.registry);
        return { callId: call.id, name: call.name, result, index };
      }),
    );

    // 串行执行副作用工具
    const unsafeResults: Array<ScheduleResult & { index: number }> = [];
    for (const { call, index } of unsafe) {
      const { result } = await executeTool(call, context, this.registry);
      unsafeResults.push({ callId: call.id, name: call.name, result, index });
    }

    // 按原始顺序合并
    const allResults = [...safeResults, ...unsafeResults].sort(
      (a, b) => a.index - b.index,
    );

    return allResults.map(({ callId, name, result }) => ({
      callId,
      name,
      result,
    }));
  }
}
