import type { ToolCall, ToolContext, ToolResult } from "./types.js";
import type { ToolRegistry } from "./registry.js";

// executeTool —— 根据 ToolCall 执行对应工具，所有异常包裹为结构化结果
export async function executeTool(
  call: ToolCall,
  context: ToolContext,
  registry: ToolRegistry,
): Promise<{ result: ToolResult; name: string }> {
  const startTime = Date.now();
  const tool = registry.get(call.name);

  if (!tool) {
    return {
      name: call.name,
      result: {
        status: "error",
        content: `未知工具：${call.name}。可用工具有：${registry.getAll().map((t) => t.name).join(", ")}。`,
        metadata: { duration: Date.now() - startTime },
      },
    };
  }

  try {
    const result = await tool.execute(call.input, {
      ...context,
      signal: context.signal,
    });

    result.metadata = {
      ...result.metadata,
      duration: Date.now() - startTime,
    };

    return { result, name: call.name };
  } catch (e) {
    return {
      name: call.name,
      result: {
        status: "error",
        content: `工具 "${call.name}" 执行异常：${(e as Error).message}`,
        metadata: { duration: Date.now() - startTime },
      },
    };
  }
}
