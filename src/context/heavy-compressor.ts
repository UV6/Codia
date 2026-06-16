import type { Message, ChatConfig, LLMProvider } from "../provider/types.js";
import type { CompressEvent } from "./types.js";
import { TokenEstimator } from "./token-estimator.js";
import { saveResult } from "./store.js";

// 摘要保留窗口：约 1 万 token
const KEEP_TOKENS = 10_000;

// 至少保留 5 条消息
const KEEP_MIN_MESSAGES = 5;

// 最大熔断失败次数
const MAX_FAILURES = 3;

// buildSummaryPrompt —— 生成摘要请求的 system prompt
// 要求：禁止工具调用、先草稿后正式摘要、五部分结构
export function buildSummaryPrompt(messagesToSummarize: Message[]): string {
  const msgCount = messagesToSummarize.length;
  const userCount = messagesToSummarize.filter((m) => m.role === "user").length;

  return `你是一个对话上下文压缩器。请将以下 ${msgCount} 条历史消息（含 ${userCount} 条用户指令）压缩为结构化摘要。

## 重要约束
1. **禁止调用任何工具。** 本次请求中你不能使用工具，只输出文本。
2. **先分析后摘要。** 用 <draft>...</draft> 标签包裹你的分析过程，再用 <summary>...</summary> 标签包裹正式摘要。<draft> 只作为你的思考草稿，后续处理会丢弃它。
3. **用户原文保留。** 用户的消息在压缩后的历史中会原样保留，你不需要在摘要中逐字复述用户的原始指令，但需要记录用户的意图和目标。
4. **代码事实优先。** 摘要中提到的文件路径、函数名、关键数值必须来自对话中的实际工具输出，不要猜测或脑补。

## 摘要结构要求
<summary> 中必须包含以下五个部分：

### 1. 任务目标与当前进度
当前正在完成什么任务，进行到哪一步。

### 2. 已做的关键决策及原因
记录已做出的重要技术决策、架构选择及其理由。

### 3. 已修改的文件及改动摘要
列出被修改的文件路径和每个文件中变动的内容概要。

### 4. 待解决的问题或待验证的假设
当前尚未解决、需要后续处理的开放问题，或基于推理的猜测需要验证。

### 5. 关键发现与注意事项
重要的技术发现、容易出错的点、需要关注的特殊情况。

## 需要摘要的消息
${formatMessagesForSummary(messagesToSummarize)}`;
}

// formatMessagesForSummary —— 将待摘要消息格式化为 LLM 可读的文本
function formatMessagesForSummary(messages: Message[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const role = msg.role;
    if (role === "system") continue;

    let content = msg.content || "";

    // 工具结果可能很长，截断到 2000 字符
    if ((msg.toolResults || msg.toolResult) && content.length > 2000) {
      content = content.slice(0, 2000) + `\n... [截断，完整结果约 ${Math.ceil(content.length / 4)} token]`;
    }

    lines.push(`[${role}]: ${content}`);
  }
  return lines.join("\n\n");
}

// splitMessages —— 将消息切分为"待摘要"和"保留原文"两部分
// 从尾部往回累积 token，直到达到保留量要求
export function splitMessages(
  messages: Message[],
  estimator: TokenEstimator,
  keepTokens: number = KEEP_TOKENS,
  keepMinMessages: number = KEEP_MIN_MESSAGES,
): { old: Message[]; recent: Message[] } {
  let accumTokens = 0;
  let recentCount = 0;
  const recent: Message[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "system") continue;

    const msgTokens = estimator.estimateTokens(msg.content || "");
    accumTokens += msgTokens;
    recent.unshift(msg);
    recentCount++;

    // 满足保留量：token >= keepTokens 且条数 >= keepMinMessages
    if (accumTokens >= keepTokens && recentCount >= keepMinMessages) {
      return {
        old: messages.slice(0, i),
        recent,
      };
    }
  }

  // 消息总数不足保留量，全量保留，不摘要
  return { old: [], recent: [...messages] };
}

// HeavyCompressor —— 重量兜底压缩
// 调用 LLM 生成结构化摘要，管理失败计数和熔断
export class HeavyCompressor {
  private failureCount = 0;
  private estimator: TokenEstimator;

  constructor(estimator: TokenEstimator) {
    this.estimator = estimator;
  }

  // isFused —— 是否已熔断
  isFused(): boolean {
    return this.failureCount >= MAX_FAILURES;
  }

  // compress —— 执行重量压缩
  // 返回处理后的 messages 和压缩事件
  async compress(
    messages: Message[],
    provider: LLMProvider,
    config: ChatConfig,
    signal: AbortSignal,
    sessionId: string,
    keepTokens: number = KEEP_TOKENS,
    keepMinMessages: number = KEEP_MIN_MESSAGES,
  ): Promise<{
    messages: Message[];
    savedTokens: number;
    summary: string;
    events: CompressEvent[];
  }> {
    const events: CompressEvent[] = [];

    // 熔断检查
    if (this.isFused()) {
      events.push({
        type: "compress",
        action: "compress_failed",
        message: "摘要已连续失败 3 次，已熔断，本次跳过压缩",
      });
      return { messages, savedTokens: 0, summary: "", events };
    }

    // 切分消息
    const { old, recent } = splitMessages(messages, this.estimator, keepTokens, keepMinMessages);

    if (old.length === 0) {
      return { messages, savedTokens: 0, summary: "", events };
    }

    const summaryPrompt = buildSummaryPrompt(old);

    // 构造摘要请求：不带工具
    const summaryMessages: Message[] = [
      {
        role: "user",
        content: summaryPrompt,
        timestamp: new Date().toISOString(),
      },
    ];

    let responseText = "";
    try {
      const stream = provider.streamChat(
        summaryMessages,
        config,
        signal,
        undefined, // 不传 tools —— 禁止工具调用
        undefined, // 不传 systemPrompt，摘要 prompt 已在 user message 中
      );

      for await (const chunk of stream) {
        if (chunk.type === "text") {
          responseText += chunk.content;
        } else if (chunk.type === "error") {
          throw new Error(`摘要 LLM 调用失败：${chunk.error.message}`);
        }
      }
    } catch (e) {
      this.failureCount++;
      events.push({
        type: "compress",
        action: "compress_failed",
        message: `摘要生成失败（${e instanceof Error ? e.message : "未知错误"}），失败次数 ${this.failureCount}/${MAX_FAILURES}`,
      });
      return { messages, savedTokens: 0, summary: "", events };
    }

    // 提取 <summary> 内容，丢弃 <draft> 段
    const summaryMatch = responseText.match(/<summary>([\s\S]*?)<\/summary>/);
    const summaryText = summaryMatch
      ? summaryMatch[1].trim()
      : responseText.replace(/<draft>[\s\S]*?<\/draft>/g, "").trim();

    if (!summaryText) {
      this.failureCount++;
      events.push({
        type: "compress",
        action: "compress_failed",
        message: `摘要内容为空，失败次数 ${this.failureCount}/${MAX_FAILURES}`,
      });
      return { messages, savedTokens: 0, summary: "", events };
    }

    // 成功：重置失败计数
    this.failureCount = 0;

    // 存盘摘要
    const timestamp = new Date().toISOString();
    const filePath = saveResult(sessionId, summaryText, {
      type: "summary",
      timestamp,
    });

    // 估算节省的 token 数（old 消息总 token - 摘要 token）
    const oldTokens = old.reduce((sum, m) => {
      if (m.role === "system") return sum;
      return sum + this.estimator.estimateTokens(m.content || "");
    }, 0);
    const savedTokens = oldTokens - this.estimator.estimateTokens(summaryText);

    // 构造新 messages：[摘要消息, 边界消息, ...保留的近期消息]
    const summaryMsg: Message = {
      role: "assistant",
      content: `[对话上下文摘要]\n\n${summaryText}\n\n完整摘要已保存至 ${filePath}`,
      timestamp,
    };

    const boundaryMsg: Message = {
      role: "user",
      content: `⚠️ 以上是之前对话的摘要，仅作背景参考。如需获得上述文件或代码的精确细节，请使用工具重新读取对应文件，不要依据摘要内容脑补任何代码或文件内容。`,
      timestamp,
    };

    const newMessages = [summaryMsg, boundaryMsg, ...recent];

    events.push({
      type: "compress",
      action: "auto_compress",
      message: `上下文已压缩：${old.length} 条消息 → 摘要（约节省 ${savedTokens} token）`,
      path: filePath,
      savedTokens,
      summary: summaryText.slice(0, 200),
    });

    return { messages: newMessages, savedTokens, summary: summaryText, events };
  }
}
