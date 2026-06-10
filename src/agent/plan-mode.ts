import type { Tool, ToolMeta } from "../tool/types.js";

// PLAN_MODE_PROMPT —— plan mode 下的行为约束 prompt
// 通过 prompt 约束模型行为，而非简单过滤工具列表
export const PLAN_MODE_PROMPT = `你当前处于 **Plan Mode（计划模式）**。

你不能执行任何修改操作，不能编辑文件、不能提交代码、不能修改配置、不能运行有副作用的命令。
唯一可以写入的文件是下面指定的 plan file。

你的工作流程：
1. 使用 read_file、grep、glob、run_command（仅只读命令）探索代码
2. 分析用户需求，设计实现方案
3. 把执行计划写入 plan file
4. 等待用户确认后再执行

plan file 路径：`;

// isPlanCommand —— 判断用户输入是否为 /plan 命令
export function isPlanCommand(text: string): boolean {
  return /^\/plan\b/.test(text.trim());
}

// isDoCommand —— 判断用户输入是否为 /do 命令
export function isDoCommand(text: string): boolean {
  return /^\/do\s*$/.test(text.trim());
}

// extractPlanMessage —— 从 /plan 命令中提取用户实际消息
// "/plan 重构认证模块" → "重构认证模块"
export function extractPlanMessage(text: string): string {
  return text.replace(/^\/plan\s*/, "").trim();
}

// filterReadOnlyTools —— 过滤出只读工具的 ToolMeta 数组
// 用于 plan mode 下给 LLM 传递受限的工具列表
export function filterReadOnlyTools(tools: Tool[]): ToolMeta[] {
  return tools
    .filter((t) => t.readOnly)
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
}
