import { describe, it, expect } from "vitest";
import {
  HeavyCompressor,
  buildSummaryPrompt,
  splitMessages,
} from "../../context/heavy-compressor.js";
import { TokenEstimator } from "../../context/token-estimator.js";
import type { Message } from "../../provider/types.js";

function makeMsg(role: Message["role"], content: string): Message {
  return { role, content, timestamp: new Date().toISOString() };
}

describe("buildSummaryPrompt", () => {
  it("包含禁止工具调用的提示", () => {
    const messages: Message[] = [makeMsg("user", "测试消息")];
    const prompt = buildSummaryPrompt(messages);
    expect(prompt).toContain("禁止调用任何工具");
  });

  it("包含 draft 和 summary 标签要求", () => {
    const messages: Message[] = [makeMsg("user", "测试消息")];
    const prompt = buildSummaryPrompt(messages);
    expect(prompt).toContain("<draft>");
    expect(prompt).toContain("<summary>");
  });

  it("包含五个部分的标题", () => {
    const messages: Message[] = [makeMsg("user", "测试消息")];
    const prompt = buildSummaryPrompt(messages);
    expect(prompt).toContain("任务目标与当前进度");
    expect(prompt).toContain("已做的关键决策及原因");
    expect(prompt).toContain("已修改的文件及改动摘要");
    expect(prompt).toContain("待解决的问题或待验证的假设");
    expect(prompt).toContain("关键发现与注意事项");
  });

  it("统计消息数量并嵌入 prompt", () => {
    const messages: Message[] = [
      makeMsg("user", "消息 1"),
      makeMsg("user", "消息 2"),
      makeMsg("assistant", "回复 1"),
    ];
    const prompt = buildSummaryPrompt(messages);
    expect(prompt).toContain("3 条历史消息");
    expect(prompt).toContain("2 条用户指令");
  });

  it("跳过 system 消息不格式化", () => {
    const messages: Message[] = [
      makeMsg("system", "系统提示词"),
      makeMsg("user", "用户消息"),
    ];
    const prompt = buildSummaryPrompt(messages);
    // system 消息内容不应出现在格式化输出中
    expect(prompt).not.toContain("系统提示词");
  });
});

describe("splitMessages", () => {
  const estimator = new TokenEstimator();

  it("消息不足保留量时全量保留", () => {
    const messages: Message[] = [
      makeMsg("user", "消息 1"),
      makeMsg("assistant", "回复 1"),
    ];

    const { old, recent } = splitMessages(messages, estimator, 10000, 5);

    expect(old).toHaveLength(0);
    expect(recent).toHaveLength(2);
  });

  it("满足保留量时切分为 old 和 recent", () => {
    // 构造 20 条消息，每条约 400 字符 → 100 token
    const messages: Message[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push(makeMsg("user", `消息 ${i}: ` + "x".repeat(396)));
    }

    // keepTokens = 1000 (约 10 条), keepMinMessages = 5
    const { old, recent } = splitMessages(messages, estimator, 1000, 5);

    //最近约 10 条保留
    expect(recent.length).toBeGreaterThanOrEqual(5);
    expect(recent.length).toBeLessThan(20);
    // 旧的被切分出去
    expect(old.length + recent.length).toBe(20);
    // old 中的消息在 recent 之前
    expect(old.length).toBeGreaterThan(0);
  });

  it("跳过 system 消息不计入保留量", () => {
    const messages: Message[] = [
      makeMsg("system", "系统提示词".repeat(100)),
      ...Array.from({ length: 10 }, (_, i) =>
        makeMsg("user", `用户消息 ${i}: ` + "x".repeat(500)),
      ),
    ];

    const { old, recent } = splitMessages(messages, estimator, 200, 3);

    // system 消息不参与计算，但会被包含在 old 中
    expect(recent.length).toBeGreaterThanOrEqual(3);
  });

  it("不切断 tool_use ↔ tool_result 配对", () => {
    // 场景：toolCallMsg(assistant with toolCalls) 在 old 中，但
    // toolResultMsg(user with toolResults) 被留在了 recent
    // 修复后 toolCallMsg 应被拉入 recent

    const msg1: Message = makeMsg("user", "开始");
    const msg2: Message = makeMsg("assistant", "好的");
    const toolCallMsg: Message = {
      role: "assistant",
      content: "我来查",
      timestamp: new Date().toISOString(),
      toolCalls: [{ id: "call_abc", name: "read_file", input: { path: "/tmp/test" } }],
    };
    const toolResultMsg: Message = {
      role: "user",
      content: "结果",
      timestamp: new Date().toISOString(),
      toolResults: [{ toolUseId: "call_abc", name: "read_file", result: { status: "success", content: "" } }],
    };
    const followUp: Message = makeMsg("assistant", "完成了");

    // 每条消息约 2-3 个 token（chars/4），total ≈ 11 tokens
    // keepTokens=2：当扫描到 toolResultMsg 时刚好满足阈值，切在 index=3
    // 此时 toolCallMsg 在 old 中 → 触发修复
    const messages: Message[] = [msg1, msg2, toolCallMsg, toolResultMsg, followUp];
    const estimator = new TokenEstimator();

    const { old, recent } = splitMessages(messages, estimator, 2, 1);

    // 修复后：toolCallMsg 被拉回 recent，确保 call_abc 的 tool_use ↔ tool_result 配对完整
    const callInRecent = recent.some(
      (m) => m.toolCalls?.some((tc) => tc.id === "call_abc"),
    );
    expect(callInRecent).toBe(true);
  });
});

describe("HeavyCompressor", () => {
  it("初始状态未熔断", () => {
    const estimator = new TokenEstimator();
    const compressor = new HeavyCompressor(estimator);
    expect(compressor.isFused()).toBe(false);
  });

  it("isFused 在失败 3 次后返回 true", async () => {
    const estimator = new TokenEstimator();
    const compressor = new HeavyCompressor(estimator);

    // 使用一个总是失败的 provider
    const badProvider = {
      name: "test",
      streamChat: async function* () {
        yield {
          type: "error" as const,
          error: { code: "network" as const, message: "模拟失败" },
        };
      },
    };

    const messages: Message[] = [
      ...Array.from({ length: 20 }, (_, i) =>
        makeMsg("user", `消息 ${i}: ` + "x".repeat(500)),
      ),
    ];

    // 设置锚点使 total > 0
    estimator.setAnchor({ inputTokens: 0 }, 0);

    // 连续失败 3 次，使用较小的 keepTokens 确保能触发压缩
    for (let i = 0; i < 3; i++) {
      await compressor.compress(
        messages,
        badProvider,
        { protocol: "anthropic", model: "test", baseUrl: "", apiKey: "" },
        new AbortController().signal,
        "test-session",
        1000, // keepTokens: 小于消息总量 2500 token
        5,
      );
    }

    expect(compressor.isFused()).toBe(true);
  });

  it("熔断后压缩直接返回原 messages", async () => {
    const estimator = new TokenEstimator();
    const compressor = new HeavyCompressor(estimator);

    // 直接构造 3 次失败来模拟熔断状态
    const badProvider = {
      name: "test",
      streamChat: async function* () {
        yield {
          type: "error" as const,
          error: { code: "network" as const, message: "模拟失败" },
        };
      },
    };

    const messages: Message[] = [
      ...Array.from({ length: 20 }, (_, i) =>
        makeMsg("user", `消息 ${i}: ` + "x".repeat(500)),
      ),
    ];

    estimator.setAnchor({ inputTokens: 0 }, 0);

    // 熔断前先 3 次失败
    for (let i = 0; i < 3; i++) {
      await compressor.compress(
        messages,
        badProvider,
        { protocol: "anthropic", model: "test", baseUrl: "", apiKey: "" },
        new AbortController().signal,
        "test-session",
        1000,
        5,
      );
    }

    expect(compressor.isFused()).toBe(true);

    // 第 4 次调用应直接返回原 messages
    const result = await compressor.compress(
      messages,
      badProvider,
      { protocol: "anthropic", model: "test", baseUrl: "", apiKey: "" },
      new AbortController().signal,
      "test-session",
      1000,
      5,
    );

    expect(result.messages).toBe(messages); // 引用相同
    expect(result.savedTokens).toBe(0);
    expect(result.events[0].action).toBe("compress_failed");
  });
});
