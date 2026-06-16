import type { ToolResult } from "../tool/types.js";
import type { CompressedResult } from "./types.js";
import { saveResult } from "./store.js";

// 单结果截断阈值（字符数）
const SINGLE_RESULT_THRESHOLD = 50_000;

// 单消息合计截断阈值（字符数）
const BATCH_TOTAL_THRESHOLD = 200_000;

// 预览保留字符数
const PREVIEW_LENGTH = 500;

// compressResult —— 单个工具结果处理（F1）
// 超过 50K 字符 → 存盘并替换为预览
export function compressResult(result: ToolResult, sessionId: string): CompressedResult {
  if (result.content.length <= SINGLE_RESULT_THRESHOLD) {
    return { result, stored: false };
  }

  const timestamp = new Date().toISOString();
  const filePath = saveResult(sessionId, result.content, {
    type: "tool_result",
    timestamp,
  });

  const preview = createPreview(result, filePath);

  return {
    result: {
      ...result,
      content: preview,
    },
    stored: true,
    filePath,
  };
}

// compressBatch —— 批量工具结果压缩（F2）
// 合并总字符数超 200K → 从大到小依次存盘替换，直到合计 < 200K
export function compressBatch(results: ToolResult[], sessionId: string): ToolResult[] {
  if (results.length === 0) return results;

  // 先逐个执行单结果截断，保留索引
  const items = results.map((result, index) => ({
    index,
    originalLen: result.content.length,
    compressed: compressResult(result, sessionId),
  }));

  // 计算合并后总字符数
  let totalChars = items.reduce((sum, item) => sum + item.compressed.result.content.length, 0);

  if (totalChars <= BATCH_TOTAL_THRESHOLD) {
    return items.map((item) => item.compressed.result);
  }

  // 按原始 content 大小降序，从最大的开始存盘（仅处理未存盘的）
  const sorted = [...items].sort((a, b) => b.originalLen - a.originalLen);

  for (const item of sorted) {
    if (totalChars <= BATCH_TOTAL_THRESHOLD) break;
    if (item.compressed.stored) continue; // F1 已处理

    const originalResult = results[item.index];
    const timestamp = new Date().toISOString();
    const filePath = saveResult(sessionId, originalResult.content, {
      type: "tool_result",
      timestamp,
    });

    const preview = createPreview(originalResult, filePath);
    const oldLen = item.compressed.result.content.length;
    item.compressed = {
      result: { ...originalResult, content: preview },
      stored: true,
      filePath,
    };
    totalChars -= oldLen - preview.length;
  }

  // 按原始索引排序返回
  items.sort((a, b) => a.index - b.index);
  return items.map((item) => item.compressed.result);
}

// createPreview —— 生成预览消息
// 格式：前 500 字符 + 路径 + token 估算
function createPreview(result: ToolResult, filePath: string): string {
  const preview = result.content.slice(0, PREVIEW_LENGTH);
  const estimatedTokens = Math.ceil(result.content.length / 4);
  return `${preview}\n\n... [完整结果已保存至 ${filePath}，约 ${estimatedTokens} token]`;
}
