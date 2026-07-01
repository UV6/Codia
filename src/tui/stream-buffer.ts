type FlushState = {
  content: string;
  thinking: string;
};

type FlushHandler = (state: FlushState) => void;

// StreamBuffer —— 把高频流式增量合并成低频刷新
export class StreamBuffer {
  private content = "";
  private thinking = "";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private flushHandler: FlushHandler,
    private delayMs: number = 32,
  ) {}

  appendText(delta: string): void {
    this.content += delta;
    this.scheduleFlush();
  }

  appendThinking(delta: string): void {
    this.thinking += delta;
    this.scheduleFlush();
  }

  flushNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flushHandler({
      content: this.content,
      thinking: this.thinking,
    });
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushHandler({
        content: this.content,
        thinking: this.thinking,
      });
    }, this.delayMs);
  }
}
