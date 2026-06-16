import type { TokenAnchor } from "./types.js";
import type { Message } from "../provider/types.js";

// TokenEstimator —— token 近似估算器
// 锚定上次 API 返回的 inputTokens，增量按字符数 ÷ 4 估算
export class TokenEstimator {
  private anchor: TokenAnchor | null = null;

  // estimateTokens —— 纯文本 token 估算
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // setAnchor —— 每次 API 调用返回后更新锚点
  setAnchor(usage: { inputTokens: number }, messageCount: number): void {
    this.anchor = {
      inputTokens: usage.inputTokens,
      messageIndex: messageCount,
    };
  }

  // estimate —— 估算 messages 数组的 token 总量
  // 跳过 role === "system" 的消息（system prompt 为固定开销，不参与压缩决策）
  estimate(messages: Message[]): number {
    if (!this.anchor) {
      // 无锚点，全量估算
      return this.estimateMessages(messages, 0);
    }

    // 有锚点：锚点值 + 锚点之后新增消息的增量
    const { inputTokens, messageIndex } = this.anchor;
    const deltaTokens = this.estimateMessages(messages, messageIndex);
    return inputTokens + deltaTokens;
  }

  // estimateMessages —— 从指定索引开始估算消息的 token 数
  private estimateMessages(messages: Message[], startIndex: number): number {
    let total = 0;
    for (let i = startIndex; i < messages.length; i++) {
      const msg = messages[i];
      // 跳过 system 消息
      if (msg.role === "system") continue;

      // 主要贡献来自 content 字段
      if (msg.content) {
        total += this.estimateTokens(msg.content);
      }

      // toolResults 中的每个 result.content 也计入
      if (msg.toolResults) {
        for (const tr of msg.toolResults) {
          total += this.estimateTokens(tr.result.content);
        }
      }
    }
    return total;
  }
}
