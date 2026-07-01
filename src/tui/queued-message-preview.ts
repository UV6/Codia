const MAX_PREVIEW_LENGTH = 24;

function truncatePreview(text: string): string {
  if (text.length <= MAX_PREVIEW_LENGTH) return text;
  return text.slice(0, MAX_PREVIEW_LENGTH) + "…";
}

// buildQueuedMessagePreviewLines —— 将待处理消息格式化为输入框上方的预览列表
export function buildQueuedMessagePreviewLines(messages: string[]): string[] {
  if (messages.length === 0) return [];

  const countLabel = messages.length === 1 ? "1 条待回复消息" : `${messages.length} 条待回复消息`;
  return [
    `⏳ 队列中 ${countLabel}`,
    ...messages.map((message, index) => `  ${index + 1}. ${truncatePreview(message)}`),
  ];
}
