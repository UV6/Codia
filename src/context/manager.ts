import type { Message, ChatConfig, LLMProvider } from "../provider/types.js";
import type { ToolResult } from "../tool/types.js";
import type { CompressEvent } from "./types.js";
import { TokenEstimator } from "./token-estimator.js";
import { HeavyCompressor } from "./heavy-compressor.js";
import { compressBatch } from "./light-compressor.js";

// 自动触发安全余量：13K（测试用临时降低）
const AUTO_SAFETY_MARGIN = 195_000;

// 手动触发保留余量：3K
const MANUAL_KEEP_MARGIN = 3_000;

// 窗口上限：200K
const CONTEXT_WINDOW = 200_000;

// ContextManager —— 上下文压缩统一入口
// 协调 TokenEstimator、LightCompressor、HeavyCompressor
export class ContextManager {
  private estimator: TokenEstimator;
  private heavyCompressor: HeavyCompressor;
  private provider: LLMProvider;
  private chatConfig: ChatConfig;
  private sessionId: string;
  private onEvent?: (event: CompressEvent) => void;

  constructor(
    provider: LLMProvider,
    chatConfig: ChatConfig,
    sessionId: string,
    onEvent?: (event: CompressEvent) => void,
  ) {
    this.provider = provider;
    this.chatConfig = chatConfig;
    this.sessionId = sessionId;
    this.onEvent = onEvent;
    this.estimator = new TokenEstimator();
    this.heavyCompressor = new HeavyCompressor(this.estimator);
  }

  // setAnchor —— 每次 API 返回后更新 token 估算锚点
  // getContextWindow —— 返回上下文窗口上限
  get contextWindow(): number {
    return CONTEXT_WINDOW;
  }

  // estimateTokens —— 估算当前消息数组的 token 数
  estimateTokens(messages: Message[]): number {
    return this.estimator.estimate(messages);
  }

  setAnchor(usage: { inputTokens: number }, messageCount: number): void {
    this.estimator.setAnchor(usage, messageCount);
  }

  // preRequest —— API 请求前调用（F4 自动触发、F9 手动触发入口）
  // auto 模式：估算 token ≥ 187K 时触发压缩
  // manual 模式：不检查阈值，直接触发压缩
  async preRequest(
    messages: Message[],
    mode: "auto" | "manual",
    signal?: AbortSignal,
  ): Promise<{ messages: Message[]; events: CompressEvent[] }> {
    const events: CompressEvent[] = [];
    const estimatedTokens = this.estimator.estimate(messages);

    if (mode === "auto") {
      const threshold = CONTEXT_WINDOW - AUTO_SAFETY_MARGIN; // 187K
      if (estimatedTokens < threshold) {
        return { messages, events };
      }
    }
    // manual 模式：不检查阈值

    const effectiveSignal = signal ?? new AbortController().signal;

    // 保留窗口大小：auto 约 10K，manual 约 3K
    const keepTokens = mode === "manual" ? MANUAL_KEEP_MARGIN : 10_000;

    const result = await this.heavyCompressor.compress(
      messages,
      this.provider,
      this.chatConfig,
      effectiveSignal,
      this.sessionId,
      keepTokens,
      5,
    );

    // 根据模式调整 action
    for (const e of result.events) {
      if (e.action === "auto_compress" && mode === "manual") {
        e.action = "manual_compress";
      }
      this.emit(e);
      events.push(e);
    }

    return { messages: result.messages, events };
  }

  // compressToolResults —— 工具执行后调用（F1, F2 入口）
  compressToolResults(results: ToolResult[]): ToolResult[] {
    const compressed = compressBatch(results, this.sessionId);

    // emit 存盘事件
    for (let i = 0; i < results.length; i++) {
      const originalLen = results[i].content.length;
      const newLen = compressed[i].content.length;
      if (newLen < originalLen) {
        this.emit({
          type: "compress",
          action: "tool_result_stored",
          message: `工具结果已截断：${originalLen} 字符 → ${newLen} 字符预览`,
          savedTokens: Math.ceil((originalLen - newLen) / 4),
        });
      }
    }

    return compressed;
  }

  private emit(event: CompressEvent): void {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }
}
