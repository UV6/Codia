import { describe, it, expect } from "vitest";
import { ConnectionManager } from "../../mcp/manager.js";
import { ToolRegistry } from "../../tool/registry.js";
import type { McpConfig } from "../../mcp/types.js";

describe("ConnectionManager", () => {
  it("空配置时不报错，不注册任何工具", async () => {
    const registry = new ToolRegistry();
    const manager = new ConnectionManager();
    await manager.connectAll({ servers: {} }, registry);
    // 无工具注册
    expect(registry.getAll().length).toBe(0);
  });

  it("单个坏 Server 不影响正常注册的已有工具", async () => {
    const registry = new ToolRegistry();

    // 先注册一个正常工具（模拟 6 个核心工具已注册的情况）
    const existingTool = {
      name: "read_file",
      description: "read",
      type: "file" as const,
      readOnly: true,
      destructive: false,
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
      async execute() {
        return { status: "success" as const, content: "" };
      },
    };
    registry.register(existingTool);

    // 配置一个坏 Server（不存在命令）
    const config: McpConfig = {
      servers: {
        bad: {
          type: "stdio",
          command: "/nonexistent/command/foo_bar_baz_xyz",
          args: [],
        },
      },
    };

    const manager = new ConnectionManager();
    await manager.connectAll(config, registry);

    // 已有工具仍在
    expect(registry.get("read_file")).toBeDefined();
    // 没有新工具注册
    expect(registry.getAll().length).toBe(1);

    // 清理
    await manager.disconnectAll();
  });

  it("disconnectAll 正常清理", async () => {
    const manager = new ConnectionManager();
    // 空配置 connectAll 不会添加 client
    const registry = new ToolRegistry();
    await manager.connectAll({ servers: {} }, registry);
    await manager.disconnectAll();
    // 不抛异常即通过
  });
});
