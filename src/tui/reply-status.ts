// getReplyStatusLabel —— 根据当前流式状态推导回复阶段文案
export function getReplyStatusLabel(
  isStreaming: boolean,
  streamingContent: string,
  _streamingThinking: string,
): string | null {
  if (!isStreaming) return null;
  return streamingContent ? "输出中..." : "思考中...";
}
