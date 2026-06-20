import type { ToolRegistry } from "../tool/registry.js";
import type { McpConfig } from "./types.js";
import { McpClient } from "./client.js";
import { createMcpToolAdapter } from "./adapter.js";

// ConnectionManager —— 管理全部 MCP Server 的连接和生命周期
export class ConnectionManager {
  private clients = new Map<string, McpClient>();

  // connectAll —— 并行连接所有 Server，注册其工具到 registry
  async connectAll(config: McpConfig, registry: ToolRegistry): Promise<void> {
    const entries = Object.entries(config.servers);
    if (entries.length === 0) {
      console.log("[MCP] 未配置 MCP Server，跳过");
      return;
    }

    console.log(`[MCP] 开始连接 ${entries.length} 个 MCP Server...`);
    const startTime = Date.now();

    const results = await Promise.allSettled(
      entries.map(async ([name, serverConfig]) => {
        try {
          // 创建并连接
          const client = new McpClient(name, serverConfig);
          await client.connect();

          // 获取工具列表
          const tools = await client.listTools();

          // 为每个工具创建适配器并注册
          let registered = 0;
          for (const toolDef of tools) {
            const adapter = createMcpToolAdapter(name, toolDef, client);

            // 检查命名冲突
            if (registry.get(adapter.name)) {
              console.warn(
                `[MCP] 工具 "${adapter.name}" 已存在，跳过注册（Server: ${name}）`,
              );
              continue;
            }

            registry.register(adapter);
            registered++;
          }

          // 成功则缓存 client
          this.clients.set(name, client);

          console.log(
            `[MCP] ${name}: 已连接，注册 ${registered} 个工具`,
          );
          return { name, success: true, toolCount: registered };
        } catch (e) {
          console.error(
            `[MCP] ${name}: 连接失败 — ${(e as Error).message}`,
          );
          return { name, success: false, error: (e as Error).message };
        }
      }),
    );

    // 汇总结果
    const succeeded = results.filter(
      (r): r is PromiseFulfilledResult<{
        name: string;
        success: true;
        toolCount: number;
      }> => r.status === "fulfilled" && r.value.success,
    );
    const failed = results.filter(
      (r) =>
        r.status === "rejected" ||
        (r.status === "fulfilled" && !r.value.success),
    );
    const totalTools = succeeded.reduce(
      (sum, r) => sum + r.value.toolCount,
      0,
    );

    console.log(
      `[MCP] 连接完成：${succeeded.length}/${entries.length} 成功，注册 ${totalTools} 个工具（${Date.now() - startTime}ms）` +
        (failed.length > 0
          ? `，${failed.length} 个失败`
          : ""),
    );
  }

  // 已连接数量
  get clientCount(): number {
    return this.clients.size;
  }

  // disconnectAll —— 依次断开所有连接
  async disconnectAll(): Promise<void> {
    for (const [name, client] of this.clients) {
      try {
        await client.disconnect();
        console.log(`[MCP] ${name}: 已断开`);
      } catch (e) {
        console.error(
          `[MCP] ${name}: 断开时出错 — ${(e as Error).message}`,
        );
      }
    }
    this.clients.clear();
  }
}
