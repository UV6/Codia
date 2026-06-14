import { describe, it, expect } from "vitest";
import { JsonRpcHandler } from "../../mcp/json-rpc.js";
import type { Transport } from "../../mcp/transport.js";
import type { JsonRpcMessage } from "../../mcp/types.js";

// fakeTransport —— 提供一个可控的假 Transport
function fakeTransport(): Transport & { messages: JsonRpcMessage[] } {
  const messages: JsonRpcMessage[] = [];
  return {
    messages,
    onMessage: null,
    async send(msg: JsonRpcMessage): Promise<void> {
      messages.push(msg);
    },
    async close(): Promise<void> {},
  };
}

describe("JsonRpcHandler", () => {
  it("发送请求后收到正确 id 的响应时 resolve", async () => {
    const transport = fakeTransport();
    const handler = new JsonRpcHandler(transport);

    // 发送请求
    const promise = handler.sendRequest("test/method", { foo: "bar" });
    expect(transport.messages.length).toBe(1);
    const sentMsg = transport.messages[0];
    expect(sentMsg).toHaveProperty("id");
    expect(sentMsg).toHaveProperty("method", "test/method");

    // 模拟收到响应
    transport.onMessage!({
      jsonrpc: "2.0",
      id: (sentMsg as { id: number }).id,
      result: { ok: true },
    });

    const result = await promise;
    expect(result).toEqual({ ok: true });
  });

  it("发送请求后收到 error 响应时 reject", async () => {
    const transport = fakeTransport();
    const handler = new JsonRpcHandler(transport);

    const promise = handler.sendRequest("test/fail");
    const sentMsg = transport.messages[0];

    transport.onMessage!({
      jsonrpc: "2.0",
      id: (sentMsg as { id: number }).id,
      error: { code: -32601, message: "Method not found" },
    });

    await expect(promise).rejects.toThrow(
      /JSON-RPC 错误 -32601: Method not found/,
    );
  });

  it("超时后 reject", async () => {
    const transport = fakeTransport();
    const handler = new JsonRpcHandler(transport, 100); // 100ms 超时

    const promise = handler.sendRequest("test/slow");

    await expect(promise).rejects.toThrow(/超时/);
  });

  it("sendNotification 发送无 id 的消息，不返回 Promise 给调用方", async () => {
    const transport = fakeTransport();
    const handler = new JsonRpcHandler(transport);

    await handler.sendNotification("test/notify", { data: 1 });
    expect(transport.messages.length).toBe(1);
    expect(transport.messages[0]).not.toHaveProperty("id");
  });

  it("收到无关 id 的响应时不匹配到 pending 请求", async () => {
    const transport = fakeTransport();
    const handler = new JsonRpcHandler(transport);

    const promise = handler.sendRequest("test/req");

    // 发送不同 id 的响应——不应匹配
    transport.onMessage!({
      jsonrpc: "2.0",
      id: 999,
      result: "wrong",
    });

    // promise 仍在 pending
    const race = await Promise.race([
      promise.then(() => "resolved"),
      new Promise((r) => setTimeout(() => r("timeout"), 100)),
    ]);
    expect(race).toBe("timeout");
  });
});
