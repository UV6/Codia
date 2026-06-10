import type { Chunk } from "../provider/types.js";
import type { AgentEvent, StreamResult } from "./types.js";

// StreamCollector —— 双重输出的流式收集器
// 消费 Provider 的原始 Chunk 流，同时：
//   a) 每个 chunk 立刻作为 AgentEvent yield 出去（低延迟，供界面实时渲染）
//   b) 内部累积完整响应（供 AgentLoop 判断是否还有工具调用）
export class StreamCollector {
  private stream: AsyncIterable<Chunk>;

  // 内部累积
  private fullText = "";
  private toolCalls: NonNullable<StreamResult["toolCalls"]> = [];
  private usage: StreamResult["usage"] = undefined;
  private hadError = false;
  private consumed = false;

  constructor(stream: AsyncIterable<Chunk>) {
    this.stream = stream;
  }

  // 实现 AsyncIterable，消费过程中同时转发和累积
  async *[Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    if (this.consumed) {
      throw new Error("StreamCollector 已消费完毕，不可重复迭代");
    }

    for await (const chunk of this.stream) {
      // 实时转发给界面
      yield chunk;

      // 内部累积
      this.accumulate(chunk);
    }

    this.consumed = true;
  }

  // accumulate —— 内部累积 chunk 到完整结果
  private accumulate(chunk: Chunk): void {
    switch (chunk.type) {
      case "text":
        this.fullText += chunk.content;
        break;

      case "tool_use":
        this.toolCalls.push(chunk.call);
        // tool_use_start 和 tool_input_delta 是中间片段，不累积
        break;

      case "usage":
        this.usage = chunk.usage;
        break;

      case "error":
        this.hadError = true;
        break;

      // 以下事件不累积到结果，仅做转发
      case "thinking":
      case "tool_use_start":
      case "tool_input_delta":
      case "tool_status":
      case "done":
        break;
    }
  }

  // getResult —— 获取完整收集结果（流消费完毕后调用）
  getResult(): StreamResult {
    if (!this.consumed) {
      throw new Error("StreamCollector 尚未消费完毕，请在迭代结束后调用 getResult()");
    }

    return {
      fullText: this.fullText,
      toolCalls: this.toolCalls,
      usage: this.usage,
      hadError: this.hadError,
    };
  }
}
