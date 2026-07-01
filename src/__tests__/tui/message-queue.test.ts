import { describe, expect, it } from "vitest";
import { MessageQueue } from "../../tui/message-queue.js";

describe("MessageQueue", () => {
  it("按入队顺序串行消费消息", async () => {
    const queue = new MessageQueue();
    const handled: string[] = [];

    queue.enqueue("第一个");
    queue.enqueue("第二个");

    await queue.drain(async (text) => {
      handled.push(text);
    });

    expect(handled).toEqual(["第一个", "第二个"]);
    expect(queue.size).toBe(0);
  });

  it("运行中追加入队也会在当前任务后继续处理", async () => {
    const queue = new MessageQueue();
    const handled: string[] = [];

    queue.enqueue("第一个");

    await queue.drain(async (text) => {
      handled.push(text);
      if (text === "第一个") {
        queue.enqueue("第二个");
      }
    });

    expect(handled).toEqual(["第一个", "第二个"]);
    expect(queue.size).toBe(0);
  });

  it("并发调用 drain 时只会启动一个消费循环", async () => {
    const queue = new MessageQueue();
    const handled: string[] = [];

    queue.enqueue("第一个");
    queue.enqueue("第二个");

    await Promise.all([
      queue.drain(async (text) => {
        handled.push(text);
      }),
      queue.drain(async (text) => {
        handled.push(`重复:${text}`);
      }),
    ]);

    expect(handled).toEqual(["第一个", "第二个"]);
  });

  it("snapshot 返回当前排队中的消息副本", () => {
    const queue = new MessageQueue();

    queue.enqueue("第二个问题");
    queue.enqueue("第三个问题");

    expect(queue.snapshot()).toEqual(["第二个问题", "第三个问题"]);
  });
});
