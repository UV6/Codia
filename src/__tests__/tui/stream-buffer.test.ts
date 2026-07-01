import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamBuffer } from "../../tui/stream-buffer.js";

describe("StreamBuffer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
  });

  it("会把短时间内的多次增量合并为一次刷新", async () => {
    vi.useFakeTimers();

    const flushHandler = vi.fn();
    const buffer = new StreamBuffer(flushHandler, 50);

    buffer.appendText("你");
    buffer.appendText("好");
    buffer.appendThinking("思");
    buffer.appendThinking("考");

    expect(flushHandler).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);

    expect(flushHandler).toHaveBeenCalledTimes(1);
    expect(flushHandler).toHaveBeenCalledWith({
      content: "你好",
      thinking: "思考",
    });

    buffer.dispose();
  });

  it("flushNow 会立刻刷新当前缓存", () => {
    vi.useFakeTimers();

    const flushHandler = vi.fn();
    const buffer = new StreamBuffer(flushHandler, 50);

    buffer.appendText("a");
    buffer.flushNow();

    expect(flushHandler).toHaveBeenCalledTimes(1);
    expect(flushHandler).toHaveBeenCalledWith({
      content: "a",
      thinking: "",
    });

    buffer.dispose();
  });
});
