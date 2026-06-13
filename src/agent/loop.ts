import type { Message, ChatConfig, LLMProvider } from "../provider/types.js";
import type { ToolContext } from "../tool/types.js";
import type { ToolRegistry } from "../tool/registry.js";
import { StreamCollector } from "./stream-collector.js";
import { ToolScheduler } from "./tool-scheduler.js";
import { filterReadOnlyTools } from "./plan-mode.js";
import type { PermissionChecker } from "../permission/checker.js";
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

  constructor(registry: ToolRegistry) {
    this.registry = registry;
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

      // 1. 根据模式选择工具列表
      const toolMetas =
        config.mode === "plan"
          ? filterReadOnlyTools(allTools)
          : allToolMetas;

      // 2. 调用 LLM 流（messages 已由 ChatService 组装好，含 reminders）
      const stream = provider.streamChat(
        messages,
        chatConfig,
        signal,
        toolMetas as unknown as Record<string, unknown>[],
        systemPrompt,
      );

      const collector = new StreamCollector(stream);

      // 3. 实时转发所有事件，同时累积完整结果
      for await (const event of collector) {
        yield event;
      }

      // 检查取消
      if (signal.aborted) {
        yield { type: "stopped", reason: "cancelled" as StopReason };
        break;
      }

      const result = collector.getResult();

      // 4. 判断停止条件
      if (result.hadError) {
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

      // 6. 调度并执行工具
      const scheduler = new ToolScheduler(this.registry);
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
        yield { type: "stopped", reason: "unknown_tool" };
        break;
      }

      // 9. 工具结果回灌到消息历史（所有结果合并为一条 user 消息）
      if (toolResults.length > 0) {
        const combinedMsg: Message = {
          role: "user",
          content: toolResults.map((r) => r.result.content).join("\n\n"),
          timestamp: new Date().toISOString(),
          toolResults: toolResults.map((r) => ({
            toolUseId: r.callId,
            result: r.result,
          })),
        };
        messages.push(combinedMsg);
      }

      round++;
      yield { type: "round_end", round };
    }

    // 达到迭代上限
    if (round >= maxRounds) {
      yield { type: "stopped", reason: "max_rounds" };
    }
  }
}
