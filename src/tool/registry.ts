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

  // 获取所有工具名
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  // 获取所有工具的 ToolMeta 数组（直接传给 Anthropic API 的 tools 字段）
  getAllMetas(): ToolMeta[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  // getAllMetasWithFilter —— 按白名单过滤 ToolMeta
  // allowedNames 存在时只返回白名单内工具的 metas，否则返回全部
  getMetasWithFilter(allowedNames?: string[]): ToolMeta[] {
    const metas = this.getAllMetas();
    if (!allowedNames || allowedNames.length === 0) return metas;
    const filterSet = new Set(allowedNames);
    return metas.filter((m) => filterSet.has(m.name));
  }

  // 返回所有 Tool 实例
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  // 获取所有只读工具
  getReadOnlyTools(): Tool[] {
    return Array.from(this.tools.values()).filter((t) => t.readOnly);
  }

  // 获取内部工具 Map 的只读引用（供 ToolScheduler 查询 destructive 标签等）
  getToolMap(): ReadonlyMap<string, Tool> {
    return this.tools;
  }

  // 从指定 Tool 数组生成 ToolMeta 数组（供 plan mode 使用）
  getMetasByTools(tools: Tool[]): ToolMeta[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }
}
