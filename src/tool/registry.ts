import type { Tool, ToolMeta } from "./types.js";

// ToolRegistry —— 工具注册中心，集中管理所有 Tool
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  // 注册工具（构造时调用）
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具 "${tool.name}" 已注册`);
    }
    this.tools.set(tool.name, tool);
  }

  // 按名查找
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  // 获取工具类型分类
  getType(name: string): "file" | "shell" | "search" | undefined {
    return this.tools.get(name)?.type;
  }

  // 获取所有工具的 ToolMeta 数组（直接传给 Anthropic API 的 tools 字段）
  getAllMetas(): ToolMeta[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  // 返回所有 Tool 实例
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }
}
