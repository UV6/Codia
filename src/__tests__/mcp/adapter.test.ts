import { describe, it, expect } from "vitest";
import { McpToolAdapter, createMcpToolAdapter } from "../../mcp/adapter.js";
import type { McpClient } from "../../mcp/client.js";
import type { ToolInputSchema } from "../../tool/types.js";

// fakeClient —— 返回预设结果的假 McpClient
function fakeClient(opts?: {
  callResult?: unknown;
  throwError?: string;
}): McpClient {
  return {
    serverName: "test",
    get connected() {
      return true;
    },
    async connect() {},
    async listTools() {
      return [];
    },
    async callTool(_name: string, _args: Record<string, unknown>) {
      if (opts?.throwError) throw new Error(opts.throwError);
      return opts?.callResult as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    },
    async disconnect() {},
  } as unknown as McpClient;
}

const testSchema: ToolInputSchema = {
  type: "object",
  properties: { query: { type: "string", description: "search query" } },
  required: ["query"],
};

describe("McpToolAdapter", () => {
  it("name 格式为 serverName_toolName", () => {
    const client = fakeClient();
    const adapter = new McpToolAdapter("filesystem", { name: "read", inputSchema: testSchema }, client);
    expect(adapter.name).toBe("filesystem_read");
  });

  it("description 透传 toolDef.description", () => {
    const client = fakeClient();
    const adapter = new McpToolAdapter("test", { name: "x", description: "my desc", inputSchema: testSchema }, client);
    expect(adapter.description).toBe("my desc");
  });

  it("无 description 时使用默认描述", () => {
    const client = fakeClient();
    const adapter = new McpToolAdapter("test", { name: "x", inputSchema: testSchema }, client);
    expect(adapter.description).toBe("test 提供的工具");
  });

  it("type 固定为 search", () => {
    const client = fakeClient();
    const adapter = new McpToolAdapter("test", { name: "x", inputSchema: testSchema }, client);
    expect(adapter.type).toBe("search");
  });

  it("readOnly 为 false", () => {
    const client = fakeClient();
    const adapter = new McpToolAdapter("test", { name: "x", inputSchema: testSchema }, client);
    expect(adapter.readOnly).toBe(false);
  });

  it("destructive 为 true（保守原则）", () => {
    const client = fakeClient();
    const adapter = new McpToolAdapter("test", { name: "x", inputSchema: testSchema }, client);
    expect(adapter.destructive).toBe(true);
  });

  it("execute 正常调用返回 success", async () => {
    const client = fakeClient({
      callResult: { content: [{ type: "text", text: "hello world" }] },
    });
    const adapter = new McpToolAdapter("test", { name: "echo", inputSchema: testSchema }, client);
    const result = await adapter.execute({ query: "test" }, { cwd: "/", signal: new AbortController().signal });
    expect(result.status).toBe("success");
    expect(result.content).toBe("hello world");
  });

  it("execute 处理 isError 为 error", async () => {
    const client = fakeClient({
      callResult: { content: [{ type: "text", text: "not found" }], isError: true },
    });
    const adapter = new McpToolAdapter("test", { name: "find", inputSchema: testSchema }, client);
    const result = await adapter.execute({ query: "x" }, { cwd: "/", signal: new AbortController().signal });
    expect(result.status).toBe("error");
    expect(result.content).toBe("not found");
  });

  it("execute 异常时返回 error", async () => {
    const client = fakeClient({ throwError: "connection lost" });
    const adapter = new McpToolAdapter("test", { name: "bad", inputSchema: testSchema }, client);
    const result = await adapter.execute({}, { cwd: "/", signal: new AbortController().signal });
    expect(result.status).toBe("error");
    expect(result.content).toContain("test");
    expect(result.content).toContain("connection lost");
  });

  it("工厂函数 createMcpToolAdapter 返回 McpToolAdapter", () => {
    const client = fakeClient();
    const adapter = createMcpToolAdapter("srv", { name: "t1", inputSchema: testSchema }, client);
    expect(adapter).toBeInstanceOf(McpToolAdapter);
    expect(adapter.name).toBe("srv_t1");
  });
});
