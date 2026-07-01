// MessageQueue —— 串行消费用户追加输入，避免并发启动多个模型回复
export class MessageQueue {
  private items: string[] = [];
  private draining = false;

  enqueue(text: string): void {
    this.items.push(text);
  }

  get size(): number {
    return this.items.length;
  }

  snapshot(): string[] {
    return [...this.items];
  }

  async drain(handler: (text: string) => Promise<void>): Promise<void> {
    if (this.draining) return;

    this.draining = true;
    try {
      while (this.items.length > 0) {
        const next = this.items.shift();
        if (next === undefined) continue;
        await handler(next);
      }
    } finally {
      this.draining = false;
    }
  }
}
