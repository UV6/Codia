import type { ToolCall, ToolContext, ToolResult } from "../tool/types.js";
import { executeTool } from "../tool/executor.js";
import type { ToolRegistry } from "../tool/registry.js";
import type { ScheduleResult } from "./types.js";
import type { PermissionChecker } from "../permission/checker.js";
import type { PermissionRequest } from "../permission/types.js";
import type { HookEngine } from "../hook/engine.js";

// ToolScheduler —— 按安全性分批执行工具调用
// destructive=false（只读）的工具并发执行（Promise.all）
// destructive=true（有副作用）的工具串行执行
// 所有工具均经过权限检查（如有 PermissionChecker）
// pre_tool / post_tool Hook 在工具执行前后触发
// 结果按原始 ToolCall 顺序排列
export class ToolScheduler {
  private registry: ToolRegistry;
  private hookEngine?: HookEngine;

  constructor(registry: ToolRegistry, hookEngine?: HookEngine) {
    this.registry = registry;
    this.hookEngine = hookEngine;
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

    // 执行单个工具调用（含权限检查 + Hook 拦截）
    const executeWithPermission = async (
      call: ToolCall,
      index: number,
    ): Promise<ScheduleResult & { index: number }> => {
      // 权限检查
      if (permissionChecker) {
        const tool = this.registry.get(call.name);
        if (tool) {
          const request: PermissionRequest = {
            toolName: call.name,
            toolType: tool.type,
            destructive: tool.destructive,
            params: call.input,
            cwd: context.cwd,
            ...tool.buildPermissionRequest?.(call.input, context),
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

      // pre_tool Hook 拦截（权限检查通过后、工具执行前）
      const hookCtx: Record<string, unknown> = {
        tool_name: call.name,
        params: call.input,
        cwd: context.cwd,
      };
      if (this.hookEngine) {
        try {
          const interceptResult = await this.hookEngine.fireIntercept("pre_tool", hookCtx);
          if (interceptResult.blocked) {
            const blockedResult: ToolResult = {
              status: "error",
              content: `[系统拦截] 工具 ${call.name}(${JSON.stringify(call.input)}) 被 Hook 规则拒绝：${interceptResult.reason}`,
              permissionDenied: true,
              metadata: { duration: 0 },
            };
            return { callId: call.id, name: call.name, result: blockedResult, index };
          }
        } catch {
          // Hook 异常不影响工具执行
        }
      }

      // 执行工具
      const startTime = Date.now();
      const { result } = await executeTool(call, context, this.registry);
      const duration = Date.now() - startTime;

      // post_tool Hook
      if (this.hookEngine) {
        try {
          await this.hookEngine.fire("post_tool", {
            tool_name: call.name,
            params: call.input,
            result,
            duration,
            cwd: context.cwd,
          });
        } catch {
          // Hook 异常不影响主流程
        }
      }

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
