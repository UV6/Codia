import type { JsonRpcMessage, JsonRpcError, JsonRpcRequest } from "./types.js";
import type { Transport } from "./transport.js";

// JsonRpcHandler —— JSON-RPC 消息编排：序列化、发送、请求-响应按 id 配对
export class JsonRpcHandler {
  private transport: Transport;
  private nextId = 1;
  private pending = new Map<
    number | string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private defaultTimeout: number;

  constructor(transport: Transport, defaultTimeoutMs = 30000) {
    this.transport = transport;
    this.defaultTimeout = defaultTimeoutMs;

    // 绑定 Transport 的 onMessage 回调
    this.transport.onMessage = (msg: JsonRpcMessage) => {
      this.handleMessage(msg);
    };
  }

  // sendRequest —— 发送 JSON-RPC 请求，返回 Promise 等待响应
  async sendRequest(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<unknown> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `MCP 请求 "${method}" (id=${id}) 超时（${timeoutMs ?? this.defaultTimeout}ms）`,
          ),
        );
      }, timeoutMs ?? this.defaultTimeout);

      this.pending.set(id, {
        resolve: (value: unknown) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.transport.send(request).catch((err) => {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  // sendNotification —— 发送 JSON-RPC 通知（无 id，不等响应）
  async sendNotification(method: string, params?: unknown): Promise<void> {
    const notification = {
      jsonrpc: "2.0" as const,
      method,
      params,
    };
    await this.transport.send(notification);
  }

  // handleMessage —— 处理收到的消息，配对请求-响应
  private handleMessage(msg: JsonRpcMessage): void {
    // 只处理带 id 的响应消息
    if ("id" in msg && !("method" in msg)) {
      const entry = this.pending.get(msg.id);
      if (!entry) return; // 非此 handler 发出的请求的响应

      this.pending.delete(msg.id);

      if (msg.error) {
        const err = msg.error as JsonRpcError;
        entry.reject(
          new Error(
            `JSON-RPC 错误 ${err.code}: ${err.message}${err.data ? ` — ${JSON.stringify(err.data)}` : ""}`,
          ),
        );
      } else {
        entry.resolve(msg.result);
      }
    }
  }

  // 清理所有 pending 请求（Transport 断开时调用）
  cancelAll(): void {
    for (const [, entry] of this.pending) {
      entry.reject(new Error("Transport 已断开"));
    }
    this.pending.clear();
  }
}
