import type { ToolCall, ToolContext, ToolResult } from "../tool/types.js";
import { executeTool } from "../tool/executor.js";
import type { ToolRegistry } from "../tool/registry.js";
import type { ScheduleResult } from "./types.js";
import type { PermissionChecker } from "../permission/checker.js";
import type { PermissionRequest } from "../permission/types.js";

// ToolScheduler —— 按安全性分批执行工具调用
// destructive=false（只读）的工具并发执行（Promise.all）
// destructive=true（有副作用）的工具串行执行
// 所有工具均经过权限检查（如有 PermissionChecker）
// 结果按原始 ToolCall 顺序排列
export class ToolScheduler {
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async schedule(
    calls: ToolCall[],
    context: ToolContext,
    permissionChecker?: PermissionChecker,
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

    // 执行单个工具调用（含权限检查）
    const executeWithPermission = async (
      call: ToolCall,
      index: number,
    ): Promise<ScheduleResult & { index: number }> => {
      if (permissionChecker) {
        const tool = this.registry.get(call.name);
        if (tool) {
          const request: PermissionRequest = {
            toolName: call.name,
            toolType: tool.type,
            destructive: tool.destructive,
            params: call.input,
            cwd: context.cwd,
          };

          const permResult = await permissionChecker.check(request);
          if (permResult.decision === "deny") {
            const deniedResult: ToolResult = {
              status: "error",
              content: `权限被拒绝：${permResult.reason}。请调整你的操作方式，或向用户解释你需要此权限的原因。`,
              permissionDenied: true,
              metadata: { duration: 0 },
            };
            return { callId: call.id, name: call.name, result: deniedResult, index };
          }
        }
      }

      const { result } = await executeTool(call, context, this.registry);
      return { callId: call.id, name: call.name, result, index };
    };

    // 并发执行只读工具
    const safeResults = await Promise.all(
      safe.map(({ call, index }) => executeWithPermission(call, index)),
    );

    // 串行执行有副作用工具
    const unsafeResults: Array<ScheduleResult & { index: number }> = [];
    for (const { call, index } of unsafe) {
      const r = await executeWithPermission(call, index);
      unsafeResults.push(r);
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
