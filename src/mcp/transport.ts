import type { JsonRpcMessage } from "./types.js";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

// Transport —— MCP 传输层接口
export interface Transport {
  send(message: JsonRpcMessage): Promise<void>;
  onMessage: ((msg: JsonRpcMessage) => void) | null;
  close(): Promise<void>;
}

// StdioTransport —— 通过子进程 stdin/stdout 管道通信
export class StdioTransport implements Transport {
  private child: ChildProcess;
  private reader: ReturnType<typeof createInterface>;
  public onMessage: ((msg: JsonRpcMessage) => void) | null = null;

  constructor(command: string, args: string[] = [], env?: Record<string, string>) {
    this.child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: env ? { ...process.env, ...env } : undefined,
    });

    // 捕获子进程异常事件，避免未处理 error 导致进程退出
    this.child.on("error", () => {
      // 错误由调用方（McpClient.connect）的 try/catch 处理
    });

    // 逐行读取 stdout
    this.reader = createInterface({ input: this.child.stdout! });
    this.reader.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed || !this.onMessage) return;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcMessage;
        this.onMessage(msg);
      } catch {
        // 非 JSON 行（如 stderr 日志混合输出）静默跳过
      }
    });

    // stderr 透传到父进程 stderr（用于调试日志）
    this.child.stderr?.on("data", (data) => {
      process.stderr.write(data);
    });
  }

  async send(message: JsonRpcMessage): Promise<void> {
    const line = JSON.stringify(message) + "\n";
    return new Promise<void>((resolve, reject) => {
      this.child.stdin!.write(line, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    this.reader.close();
    this.child.kill();
  }
}

// HttpTransport —— 通过 HTTP POST 通信（支持 SSE 流式响应）
export class HttpTransport implements Transport {
  private url: string;
  private headers: Record<string, string>;
  public onMessage: ((msg: JsonRpcMessage) => void) | null = null;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.url = url;
    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    };
  }

  async send(message: JsonRpcMessage): Promise<void> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("text/event-stream")) {
      // SSE 流式响应：按 data: 行解析 JSON-RPC 消息
      const text = await response.text();
      for (const line of text.split("\n")) {
        if (line.startsWith("data: ") && this.onMessage) {
          const data = line.slice(6);
          try {
            const msg = JSON.parse(data) as JsonRpcMessage;
            this.onMessage(msg);
          } catch {
            // 跳过非 JSON data
          }
        }
      }
    } else {
      // 普通 JSON 响应
      const msg = (await response.json()) as JsonRpcMessage;
      if (this.onMessage) {
        this.onMessage(msg);
      }
    }
  }

  async close(): Promise<void> {
    // HTTP 无持久连接，无需关闭
  }
}
