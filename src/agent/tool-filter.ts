import type { Tool, ToolMeta } from "../tool/types.js";
import type { AgentRole } from "./role/types.js";

// GLOBAL_BLOCKED_TOOLS —— 第一层：全局禁止，所有子 Agent 永远不可用
const GLOBAL_BLOCKED_TOOLS = new Set(["Agent", "AskUserQuestion", "TaskStop"]);

// ASYNC_AGENT_ALLOWED_TOOLS —— 第三层：后台白名单，仅包含纯只读工具
// 明确排除：Agent、TaskCreate、TaskUpdate、TaskList、TaskGet、SendMessage
const ASYNC_AGENT_ALLOWED_TOOLS = new Set([
  "read_file",
  "glob",
  "grep",
]);

// ToolFilterPipeline —— 四层过滤器链，系统级先收窄，角色定义做精筛
export class ToolFilterPipeline {
  // apply —— 串联四层过滤，返回过滤后的 ToolMeta[]
  static apply(
    allTools: Tool[],
    role: AgentRole | null,
    runInBackground: boolean,
    type: "definition" | "fork",
    customDisallowed?: string[],
  ): ToolMeta[] {
    let tools = allTools;

    // 第一层：全局禁止
    tools = Layer1GlobalBlock(tools);

    // 第二层：自定义额外禁止
    tools = Layer2CustomDisallow(tools, customDisallowed);

    // 第三层：后台白名单
    tools = Layer3BackgroundAllow(tools, runInBackground);

    // 第四层：角色定义（仅定义式）
    tools = Layer4RoleFilter(tools, role, type);

    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }
}

// Layer1GlobalBlock —— 剔除全局禁止工具
export function Layer1GlobalBlock(allTools: Tool[]): Tool[] {
  return allTools.filter((t) => !GLOBAL_BLOCKED_TOOLS.has(t.name));
}

// Layer2CustomDisallow —— 按自定义列表剔除
export function Layer2CustomDisallow(
  tools: Tool[],
  customDisallowed?: string[],
): Tool[] {
  if (!customDisallowed || customDisallowed.length === 0) return tools;
  const blockSet = new Set(customDisallowed);
  return tools.filter((t) => !blockSet.has(t.name));
}

// Layer3BackgroundAllow —— 后台模式下按白名单过滤
export function Layer3BackgroundAllow(
  tools: Tool[],
  runInBackground: boolean,
): Tool[] {
  if (!runInBackground) return tools;
  return tools.filter((t) => ASYNC_AGENT_ALLOWED_TOOLS.has(t.name));
}

// Layer4RoleFilter —— 按角色的 tools/disallowedTools 过滤（仅定义式生效）
export function Layer4RoleFilter(
  tools: Tool[],
  role: AgentRole | null,
  type: "definition" | "fork",
): Tool[] {
  if (type === "fork" || !role) return tools;

  let filtered = tools;

  // 白名单非空时，只允许白名单内的工具
  if (role.frontmatter.tools && role.frontmatter.tools.length > 0) {
    const allowSet = new Set(role.frontmatter.tools);
    filtered = filtered.filter((t) => allowSet.has(t.name));
  }

  // 黑名单在白名单结果上再剔除
  if (role.frontmatter.disallowedTools && role.frontmatter.disallowedTools.length > 0) {
    const denySet = new Set(role.frontmatter.disallowedTools);
    filtered = filtered.filter((t) => !denySet.has(t.name));
  }

  return filtered;
}
