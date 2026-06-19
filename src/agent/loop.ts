import type { Message, ChatConfig, LLMProvider } from "../provider/types.js";
import type { ToolContext } from "../tool/types.js";
import type { ToolRegistry } from "../tool/registry.js";
import { StreamCollector } from "./stream-collector.js";
import { ToolScheduler } from "./tool-scheduler.js";
import { filterReadOnlyTools } from "./plan-mode.js";
import type { PermissionChecker } from "../permission/checker.js";
import type { HookEngine } from "../hook/engine.js";
import type { ContextManager } from "../context/manager.js";
import type { CompressEvent } from "../context/types.js";
import type {
  AgentEvent,
  AgentLoopConfig,
  StopReason,
  ScheduleResult,
} from "./types.js";

// DEFAULT_MAX_ROUNDS —— 默认迭代上限
export const DEFAULT_MAX_ROUNDS = 20;

// AgentLoop —— ReAct 模式的核心循环
// 驱动 "调用 LLM → 收集响应 → 判断停止 → 分批执行工具 → 结果回灌 → 下一轮"
export class AgentLoop {
  private registry: ToolRegistry;
  private contextManager?: ContextManager;
  private hookEngine?: HookEngine;

  constructor(
    registry: ToolRegistry,
    contextManager?: ContextManager,
    hookEngine?: HookEngine,
  ) {
    this.registry = registry;
    this.contextManager = contextManager;
    this.hookEngine = hookEngine;
  }

  async *run(
    messages: Message[],
    provider: LLMProvider,
    chatConfig: ChatConfig,
    config: AgentLoopConfig,
    signal: AbortSignal,
    cwd: string = process.cwd(),
    systemPrompt?: string,
    permissionChecker?: PermissionChecker,
  ): AsyncIterable<AgentEvent> {
    const maxRounds = config.maxRounds || DEFAULT_MAX_ROUNDS;
    const allTools = this.registry.getAll();
    const allToolMetas = this.registry.getAllMetas();

    let round = 0;

    while (round < maxRounds) {
      yield { type: "round_start", round };

      // turn_start Hook
      if (this.hookEngine) {
        try {
          await this.hookEngine.fire("turn_start", {
            round,
            cwd,
            message_count: messages.length,
          });
        } catch {
          // Hook 异常不影响主流程
        }
      }

      // 1. 根据白名单/模式选择工具列表
      const toolMetas = config.allowedTools
        ? this.registry.getMetasWithFilter(config.allowedTools)
        : config.mode === "plan"
          ? filterReadOnlyTools(allTools)
          : allToolMetas;

      // 1.5 上下文压缩检查（每次 API 请求前）
      if (this.contextManager) {
        const preResult = await this.contextManager.preRequest(messages, "auto", signal);
        // 只在压缩实际发生时替换（preRequest 未触发压缩时返回同一引用）
        if (preResult.messages !== messages) {
          messages.length = 0;
          messages.push(...preResult.messages);
        }
        // yield 压缩事件
        for (const e of preResult.events) {
          yield e;
        }
      }

      // pre_llm Hook（prompt 动作可注入到 system_prompt）
      let effectiveSystemPrompt = systemPrompt;
      if (this.hookEngine) {
        try {
          await this.hookEngine.fire(
            "pre_llm",
            { message_count: messages.length, system_prompt: systemPrompt },
            {
              onPrompt: (text: string) => {
                effectiveSystemPrompt = effectiveSystemPrompt
                  ? `${effectiveSystemPrompt}\n\n${text}`
                  : text;
              },
            },
          );
        } catch {
          // Hook 异常不影响主流程
        }
      }

      // 2. 调用 LLM 流（messages 已由 ChatService 组装好，含 reminders）
      const stream = provider.streamChat(
        messages,
        chatConfig,
        signal,
        toolMetas as unknown as Record<string, unknown>[],
        effectiveSystemPrompt,
      );

      const collector = new StreamCollector(stream);

      // 3. 实时转发所有事件，同时累积完整结果
      for await (const event of collector) {
        yield event;
      }

      // 检查取消
      if (signal.aborted) {
        await this.fireTurnEnd(round, "cancelled");
        yield { type: "stopped", reason: "cancelled" as StopReason };
        break;
      }

      const result = collector.getResult();

      // post_llm Hook
      if (this.hookEngine) {
        try {
          await this.hookEngine.fire("post_llm", {
            response: result.fullText,
            usage: result.usage,
          });
        } catch {
          // Hook 异常不影响主流程
        }
      }

      // 4. 判断停止条件
      if (result.hadError) {
        await this.fireTurnEnd(round, "stream_error");
        yield { type: "stopped", reason: "stream_error" };
        break;
      }

      if (result.toolCalls.length === 0) {
        // 保存最终文本回复
        if (result.fullText) {
          const finalMsg: Message = {
            role: "assistant",
            content: result.fullText,
            timestamp: new Date().toISOString(),
            usage: result.usage,
          };
          messages.push(finalMsg);
        }
        // 更新 token 估算锚点
        if (result.usage && this.contextManager) {
          this.contextManager.setAnchor(result.usage, messages.length);
        }
        await this.fireTurnEnd(round, "done");
        yield { type: "stopped", reason: "done" };
        break;
      }

      // 5. 保存 assistant(tool_use) 消息
      const assistantMsg: Message = {
        role: "assistant",
        content: result.fullText,
        timestamp: new Date().toISOString(),
        toolCalls: result.toolCalls,
        usage: result.usage,
      };
      messages.push(assistantMsg);

      // 更新 token 估算锚点
      if (result.usage && this.contextManager) {
        this.contextManager.setAnchor(result.usage, messages.length);
      }

      // 6. 调度并执行工具
      const scheduler = new ToolScheduler(this.registry, this.hookEngine);
      const context: ToolContext = { cwd, signal };

      let toolResults: ScheduleResult[];
      try {
        toolResults = await scheduler.schedule(
          result.toolCalls,
          context,
          permissionChecker,
        );
      } catch (e) {
        // 调度器自身异常（不应发生，但兜底）
        await this.fireTurnEnd(round, "stream_error");
        yield { type: "stopped", reason: "stream_error" };
        break;
      }

      // 7. yield 工具执行结果
      for (const r of toolResults) {
        yield {
          type: "tool_result",
          callId: r.callId,
          name: r.name,
          result: r.result,
        };
      }

      // 8. 未知工具检测：所有工具都返回"未知工具"错误时停止
      const unknownCount = toolResults.filter((r) =>
        r.result.content.startsWith("未知工具："),
      ).length;
      if (unknownCount > 0 && unknownCount === toolResults.length) {
        await this.fireTurnEnd(round, "unknown_tool");
        yield { type: "stopped", reason: "unknown_tool" };
        break;
      }

      // 9. 轻量压缩：处理超大工具结果
      let processedResults = toolResults.map((r) => r.result);
      if (this.contextManager) {
        processedResults = this.contextManager.compressToolResults(processedResults);
      }

      // 10. 工具结果回灌到消息历史（所有结果合并为一条 user 消息）
      if (toolResults.length > 0) {
        const combinedMsg: Message = {
          role: "user",
          content: processedResults.map((r) => r.content).join("\n\n"),
          timestamp: new Date().toISOString(),
          toolResults: toolResults.map((r, i) => ({
            toolUseId: r.callId,
            result: processedResults[i],
          })),
        };
        messages.push(combinedMsg);
      }

      round++;

      // turn_end Hook（正常继续下一轮）
      if (this.hookEngine) {
        try {
          await this.hookEngine.fire("turn_end", { round, stop_reason: "in_progress" });
        } catch {
          // Hook 异常不影响主流程
        }
      }

      yield { type: "round_end", round };
    }

    // 达到迭代上限
    if (round >= maxRounds) {
      await this.fireTurnEnd(round, "max_rounds");
      yield { type: "stopped", reason: "max_rounds" };
    }
  }

  // fireTurnEnd —— 在轮次结束触发 turn_end Hook
  private async fireTurnEnd(round: number, stopReason: string): Promise<void> {
    if (!this.hookEngine) return;
    try {
      await this.hookEngine.fire("turn_end", { round, stop_reason: stopReason });
    } catch {
      // Hook 异常不影响主流程
    }
  }
}
