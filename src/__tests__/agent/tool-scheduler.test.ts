import { describe, it, expect } from "vitest";
import { ToolScheduler } from "../../agent/tool-scheduler.js";
import type { Tool, ToolContext, ToolInputSchema } from "../../tool/types.js";
import type { ToolRegistry } from "../../tool/registry.js";

// 构造一个简单的内存 ToolRegistry 用于测试
class TestRegistry implements Pick<ToolRegistry, "get" | "getAll"> {
  private toolsArr: Tool[];
  private toolMap = new Map<string, Tool>();
  constructor(tools: Tool[]) {
    this.toolsArr = tools;
    for (const t of tools) this.toolMap.set(t.name, t);
  }
  get(name: string) { return this.toolMap.get(name); }
  getAll() { return this.toolsArr; }
}

const ctx: ToolContext = { cwd: "/tmp", signal: new AbortController().signal };

function makeTool(overrides: Partial<Tool>): Tool {
  const schema: ToolInputSchema = { type: "object", properties: {} };
  return {
    name: "test",
    description: "desc",
    type: "file",
    readOnly: true,
    destructive: false,
    inputSchema: schema,
    execute: async () => ({ status: "success", content: "ok" }),
    ...overrides,
  };
}

describe("ToolScheduler", () => {
  it("空调用列表 → 返回空数组", async () => {
    const registry = new TestRegistry([]) as unknown as ToolRegistry;
    const scheduler = new ToolScheduler(registry);
    const results = await scheduler.schedule([], ctx);
    expect(results).toEqual([]);
  });

  it("两个只读工具并发执行", async () => {
    const startTimes: number[] = [];
    const tools: Tool[] = [
      makeTool({
        name: "read_a",
        readOnly: true,
        destructive: false,
        execute: async () => {
          startTimes.push(Date.now());
          await new Promise((r) => setTimeout(r, 50));
          return { status: "success", content: "a" };
        },
      }),
      makeTool({
        name: "read_b",
        readOnly: true,
        destructive: false,
        execute: async () => {
          startTimes.push(Date.now());
          await new Promise((r) => setTimeout(r, 50));
          return { status: "success", content: "b" };
        },
      }),
    ];

    const registry = new TestRegistry(tools) as unknown as ToolRegistry;
    const scheduler = new ToolScheduler(registry);
    const calls = [
      { id: "1", name: "read_a", input: {} },
      { id: "2", name: "read_b", input: {} },
    ];

    const t0 = Date.now();
    const results = await scheduler.schedule(calls, ctx);
    const elapsed = Date.now() - t0;

    // 并发执行：总耗时应接近 50ms 而非 100ms
    expect(elapsed).toBeLessThan(150);
    // 两个 start_time 应非常接近（< 5ms 差）
    expect(Math.abs(startTimes[0] - startTimes[1])).toBeLessThan(10);

    expect(results).toHaveLength(2);
    expect(results[0].callId).toBe("1");
    expect(results[1].callId).toBe("2");
  });

  it("两个 destructive 工具串行执行", async () => {
    const startTimes: number[] = [];
    const tools: Tool[] = [
      makeTool({
        name: "write_a",
        readOnly: false,
        destructive: true,
        execute: async () => {
          startTimes.push(Date.now());
          await new Promise((r) => setTimeout(r, 50));
          return { status: "success", content: "a" };
        },
      }),
      makeTool({
        name: "write_b",
        readOnly: false,
        destructive: true,
        execute: async () => {
          startTimes.push(Date.now());
          await new Promise((r) => setTimeout(r, 50));
          return { status: "success", content: "b" };
        },
      }),
    ];

    const registry = new TestRegistry(tools) as unknown as ToolRegistry;
    const scheduler = new ToolScheduler(registry);
    const calls = [
      { id: "1", name: "write_a", input: {} },
      { id: "2", name: "write_b", input: {} },
    ];

    const t0 = Date.now();
    await scheduler.schedule(calls, ctx);
    const elapsed = Date.now() - t0;

    // 串行执行：总耗时 >= 100ms
    expect(elapsed).toBeGreaterThan(80);

    // 两个 start_time 应差距 >= 30ms
    expect(startTimes[1] - startTimes[0]).toBeGreaterThan(30);
  });

  it("混合工具调用按原始顺序返回结果", async () => {
    const tools: Tool[] = [
      makeTool({ name: "read", readOnly: true, destructive: false,
        execute: async () => ({ status: "success", content: "read" }) }),
      makeTool({ name: "write", readOnly: false, destructive: true,
        execute: async () => ({ status: "success", content: "write" }) }),
      makeTool({ name: "grep", readOnly: true, destructive: false,
        execute: async () => ({ status: "success", content: "grep" }) }),
    ];

    const registry = new TestRegistry(tools) as unknown as ToolRegistry;
    const scheduler = new ToolScheduler(registry);
    const calls = [
      { id: "1", name: "read", input: {} },
      { id: "2", name: "write", input: {} },
      { id: "3", name: "grep", input: {} },
    ];

    const results = await scheduler.schedule(calls, ctx);

    // 结果按原始顺序排列
    expect(results).toHaveLength(3);
    expect(results[0].callId).toBe("1"); // read
    expect(results[1].callId).toBe("2"); // write
    expect(results[2].callId).toBe("3"); // grep
  });

  it("单个工具执行失败不抛异常，结果正常返回", async () => {
    const tools: Tool[] = [
      makeTool({
        name: "bad_tool",
        readOnly: true,
        destructive: false,
        execute: async () => {
          throw new Error("boom");
        },
      }),
    ];

    const registry = new TestRegistry(tools) as unknown as ToolRegistry;
    const scheduler = new ToolScheduler(registry);
    const calls = [{ id: "1", name: "bad_tool", input: {} }];

    // 不应抛出异常
    const results = await scheduler.schedule(calls, ctx);

    expect(results).toHaveLength(1);
    expect(results[0].result.status).toBe("error");
    expect(results[0].result.content).toContain("boom");
  });

  it("未知工具返回错误结果", async () => {
    const registry = new TestRegistry([]) as unknown as ToolRegistry;
    const scheduler = new ToolScheduler(registry);
    const calls = [{ id: "1", name: "nonexistent", input: {} }];

    const results = await scheduler.schedule(calls, ctx);

    expect(results).toHaveLength(1);
    expect(results[0].result.status).toBe("error");
    expect(results[0].result.content).toContain("未知工具");
  });
});
