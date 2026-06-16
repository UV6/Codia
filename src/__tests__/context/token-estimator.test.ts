import { describe, it, expect } from "vitest";
import { TokenEstimator } from "../../context/token-estimator.js";
import type { Message } from "../../provider/types.js";

function makeMsg(role: Message["role"], content: string): Message {
  return { role, content, timestamp: new Date().toISOString() };
}

describe("TokenEstimator", () => {
  describe("estimateTokens", () => {
    it("空字符串返回 0", () => {
      const estimator = new TokenEstimator();
      expect(estimator.estimateTokens("")).toBe(0);
    });

    it('"hello world" (11 字符) 返回 3', () => {
      const estimator = new TokenEstimator();
      expect(estimator.estimateTokens("hello world")).toBe(3);
    });

    it("中文文本按字符数 ÷ 4 估算", () => {
      const estimator = new TokenEstimator();
      // 40 个中文字符 → 40/4 = 10
      const text = "你好世界".repeat(10); // 40 chars
      expect(estimator.estimateTokens(text)).toBe(10);
    });
  });

  describe("estimate (无锚点)", () => {
    it("全量按字符数 ÷ 4 估算", () => {
      const estimator = new TokenEstimator();
      const messages: Message[] = [
        makeMsg("user", "你好"), // 2 chars → 1
        makeMsg("assistant", "你好！"), // 3 chars → 1
      ];
      // 总 5 字符 / 4 = 2
      expect(estimator.estimate(messages)).toBe(2);
    });

    it("跳过 system 消息", () => {
      const estimator = new TokenEstimator();
      const messages: Message[] = [
        makeMsg("system", "这是一个很长的 system prompt 不应该被计入".repeat(100)), // 大量字符
        makeMsg("user", "hello"), // 5 chars → 2
      ];
      // 只应计算 user 消息：5/4 = 2
      expect(estimator.estimate(messages)).toBe(2);
    });
  });

  describe("estimate (有锚点)", () => {
    it("锚点值 + 增量估算", () => {
      const estimator = new TokenEstimator();

      // 设置锚点：前 10 条消息占 5000 token
      const initialMsgs = Array.from({ length: 10 }, (_, i) =>
        makeMsg("user", `消息 ${i} 的内容`),
      );
      estimator.setAnchor({ inputTokens: 5000 }, 10);

      // 新增 3 条消息，每条约 10 字符 → 10/4 = 3 token 每条
      const newMsgs = [
        ...initialMsgs,
        makeMsg("user", "0123456789"), // 10 chars → 3
        makeMsg("user", "0123456789"), // 10 chars → 3
        makeMsg("user", "0123456789"), // 10 chars → 3
      ];

      // 5000 + 9 = 5009
      expect(estimator.estimate(newMsgs)).toBe(5009);
    });

    it("增量中跳过 system 消息", () => {
      const estimator = new TokenEstimator();

      const initialMsgs: Message[] = [makeMsg("user", "第一条消息")];
      estimator.setAnchor({ inputTokens: 100 }, 1);

      const newMsgs: Message[] = [
        ...initialMsgs,
        makeMsg("system", "新的 system 消息不应计入".repeat(50)),
        makeMsg("user", "abcd"), // 4 chars → 1
      ];

      // 100 + 1 = 101
      expect(estimator.estimate(newMsgs)).toBe(101);
    });
  });
});
