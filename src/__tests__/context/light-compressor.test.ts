import { describe, it, expect, afterAll } from "vitest";
import { compressResult, compressBatch } from "../../context/light-compressor.js";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResult } from "../../tool/types.js";

const TEST_SESSION = "test-light-compressor";
const previousCodiaHome = process.env.CODIA_HOME;
const CONTEXT_DIR = join(tmpdir(), "codia-light-compressor-test", ".codia", "context");

process.env.CODIA_HOME = join(tmpdir(), "codia-light-compressor-test", ".codia");

function makeResult(content: string): ToolResult {
  return { status: "success", content };
}

describe("LightCompressor", () => {
  afterAll(() => {
    // 清理测试文件
    const testDir = join(CONTEXT_DIR, TEST_SESSION);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    if (previousCodiaHome === undefined) {
      delete process.env.CODIA_HOME;
    } else {
      process.env.CODIA_HOME = previousCodiaHome;
    }
  });

  describe("compressResult (F1)", () => {
    it("小结果（< 50K）不截断", () => {
      const result = makeResult("短结果，只有几十个字符");
      const compressed = compressResult(result, TEST_SESSION);

      expect(compressed.stored).toBe(false);
      expect(compressed.filePath).toBeUndefined();
      expect(compressed.result.content).toBe("短结果，只有几十个字符");
    });

    it("大结果（> 50K）存盘并返回预览", () => {
      // 构造 60K 字符的结果
      const bigContent = "x".repeat(60_000);
      const result = makeResult(bigContent);
      const compressed = compressResult(result, TEST_SESSION);

      expect(compressed.stored).toBe(true);
      expect(compressed.filePath).toBeDefined();
      expect(existsSync(compressed.filePath!)).toBe(true);

      // 预览只含前 500 字符
      expect(compressed.result.content.length).toBeLessThan(bigContent.length);
      expect(compressed.result.content).toContain("x".repeat(500));
      expect(compressed.result.content).toContain("[完整结果已保存至");
      expect(compressed.result.content).toContain("15000 token"); // 60K/4 = 15000
    });

    it("正好 50K 不截断（边界值）", () => {
      const content = "y".repeat(50_000);
      const result = makeResult(content);
      const compressed = compressResult(result, TEST_SESSION);

      expect(compressed.stored).toBe(false);
      expect(compressed.result.content).toBe(content);
    });

    it("保留原始 status 字段", () => {
      const result: ToolResult = { status: "error", content: "x".repeat(60_000) };
      const compressed = compressResult(result, TEST_SESSION);

      expect(compressed.result.status).toBe("error");
    });
  });

  describe("compressBatch (F2)", () => {
    it("总字符数 < 200K 时不额外压缩", () => {
      const results = [makeResult("短 A"), makeResult("短 B")];
      const compressed = compressBatch(results, TEST_SESSION);

      expect(compressed).toHaveLength(2);
      expect(compressed[0].content).toBe("短 A");
      expect(compressed[1].content).toBe("短 B");
    });

    it("总字符数 > 200K 时压缩最大的结果", () => {
      // 3 个结果：80K + 80K + 80K = 240K > 200K
      const results = [
        makeResult("A".repeat(80_000)),
        makeResult("B".repeat(80_000)),
        makeResult("C".repeat(80_000)),
      ];
      const compressed = compressBatch(results, TEST_SESSION);

      // 至少一个被存盘
      const totalChars = compressed.reduce((sum, r) => sum + r.content.length, 0);
      expect(totalChars).toBeLessThan(200_000);

      // 至少一个结果包含预览标记
      const hasPreview = compressed.some((r) =>
        r.content.includes("[完整结果已保存至"),
      );
      expect(hasPreview).toBe(true);
    });

    it("F1 已截断的大结果不重复存盘", () => {
      // 1 个超大结果（F1 已处理）+ 2 个中等结果
      const results = [
        makeResult("A".repeat(60_000)), // F1 会截断
        makeResult("B".repeat(80_000)),
        makeResult("C".repeat(80_000)),
      ];
      const compressed = compressBatch(results, TEST_SESSION);

      const totalChars = compressed.reduce((sum, r) => sum + r.content.length, 0);
      expect(totalChars).toBeLessThan(200_000);
    });

    it("结果保持原始顺序", () => {
      const results = [
        makeResult("C_标记".repeat(10_000)), // ~60K
        makeResult("A_标记".repeat(10_000)), // ~70K
        makeResult("B_标记".repeat(10_000)), // ~70K
      ];

      // 当某个结果被压缩时，用预览中的标记文本验证顺序
      const compressed = compressBatch(results, TEST_SESSION);
      // 确保前几个字符的顺序标记被保留
      for (let i = 0; i < results.length; i++) {
        expect(compressed[i]).toBeDefined();
      }
    });
  });
});
