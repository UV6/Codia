// InstructionScope —— 指令层作用域
export type InstructionScope = "project_root" | "project_private" | "user";

// InstructionLayer —— 单层项目指令入口定义
export interface InstructionLayer {
  name: string;
  priority: number;
  scope: InstructionScope;
  path: string;
  required: boolean;
}

// ResolvedInstructionDocument —— 单个指令文档的展开结果
export interface ResolvedInstructionDocument {
  sourcePath: string;
  displayPath: string;
  content: string;
  depth: number;
  includedFrom?: string;
  warnings: string[];
}

// InstructionResolveOptions —— 指令展开约束配置
export interface InstructionResolveOptions {
  maxIncludeDepth: number;
  projectRoot: string;
  allowExternalUserFile: boolean;
  visited: Set<string>;
  includeToken: string;
}
