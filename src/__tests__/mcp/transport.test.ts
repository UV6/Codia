import { describe, it, expect } from "vitest";
import { StdioTransport } from "../../mcp/transport.js";
import type { JsonRpcNotification } from "../../mcp/types.js";

describe("StdioTransport", () => {
  it("spawn 失败后 send 返回 spawn 错误（ENOENT），而不是挂起或 write EPIPE", async () => {
    const transport = new StdioTransport(
      "/nonexistent/command/foo_bar_baz_xyz",
    );

    // 等待 Node.js 异步触发 spawn error 事件
    await new Promise((resolve) => setTimeout(resolve, 100));

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method: "test",
    };

    await expect(transport.send(notification)).rejects.toThrow("ENOENT");

    await transport.close();
  });

  it("spawn 失败后 send 不长时间挂起", async () => {
    const transport = new StdioTransport(
      "/nonexistent/command/foo_bar_baz_xyz",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const start = Date.now();
    await expect(
      transport.send({ jsonrpc: "2.0", method: "test" }),
    ).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(500);

    await transport.close();
  }, 1000);
});
