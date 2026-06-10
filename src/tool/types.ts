// ToolInputSchema —— JSON Schema 参数定义，符合 Anthropic API 格式
export interface ToolInputSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description: string;
      default?: unknown;
      enum?: string[];
    }
  >;
  required?: string[];
}

// ToolContext —— 工具执行时的环境上下文
export interface ToolContext {
  cwd: string; // 项目根目录
  signal: AbortSignal; // 取消信号
}

// ToolResult —— 工具执行结果，总是结构化返回给模型
export interface ToolResult {
  status: "success" | "error";
  content: string;
  metadata?: {
    bytesWritten?: number;
    lineCount?: number;
    fileCount?: number;
    duration?: number;
    exitCode?: number;
  };
}

// ToolMeta —— 从 Tool 提取，直接传给 API 的 tools 数组
export interface ToolMeta {
  name: string;
  description: string;
  input_schema: ToolInputSchema; // 下划线命名，与 Anthropic API 一致
}

// ToolCall —— 模型请求的工具调用（从流式 tool_use chunk 解析得到）
export interface ToolCall {
  id: string; // tool_use block 的 id，用于回灌 tool_result
  name: string; // 工具名
  input: Record<string, unknown>; // 已解析的参数
}

// Tool —— 统一的工具接口，每个工具必须实现
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly type: "file" | "shell" | "search";
  readonly readOnly: boolean;
  readonly destructive: boolean;
  readonly inputSchema: ToolInputSchema;
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
