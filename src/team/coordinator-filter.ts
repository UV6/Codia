import type { Tool } from "../tool/types.js";
import type { AppConfig } from "../config/index.js";

// Coordinator 模式下允许的工具白名单（使用实际注册名）
const COORDINATOR_ALLOWED_TOOLS = [
  "read_file",
  "run_command",
  "Agent",
  "TaskList",
  "TaskGet",
  "TaskCreate",
  "TaskUpdate",
  "TaskStop",
  "SendMessage",
  "WebFetch",
  "WebSearch",
  // codegraph_* 系列（MCP 前缀）
  "mcp__codegraph__codegraph_search",
  "mcp__codegraph__codegraph_callers",
  "mcp__codegraph__codegraph_callees",
  "mcp__codegraph__codegraph_context",
  "mcp__codegraph__codegraph_trace",
  "mcp__codegraph__codegraph_impact",
  "mcp__codegraph__codegraph_node",
  "mcp__codegraph__codegraph_explore",
  "mcp__codegraph__codegraph_files",
  "mcp__codegraph__codegraph_status",
  // 团队工具
  "TeamTaskList",
  "TeamTaskGet",
  "TeamTaskCreate",
  "TeamTaskUpdate",
  "TeamTaskDelete",
  "SendMessage",
  "BroadcastMessage",
  "ReadInbox",
  "RequestApproval",
  "StopMember",
  "MergeWorktrees",
  // 读类 MCP 工具前缀匹配（通过通配逻辑在运行时匹配）
];

// CoordinatorFilter —— coordinator 模式的两把锁 + 白名单过滤
export class CoordinatorFilter {
  // isEnabled —— 检查 coordinator 是否生效（两把锁）
  static isEnabled(config?: AppConfig): boolean {
    if (!config) return false;
    // 第一把锁：配置能力开关
    const configEnabled = config.coordinator?.enabled === true;
    // 第二把锁：环境变量
    const envEnabled = process.env.CODIA_COORDINATOR === "1";
    return configEnabled && envEnabled;
  }

  // getAllowedTools —— 获取 coordinator 模式下的工具白名单
  static getAllowedTools(): string[] {
    return [...COORDINATOR_ALLOWED_TOOLS];
  }

  // apply —— 应用 coordinator 过滤
  static apply(allTools: Tool[], config?: AppConfig): Tool[] {
    if (!this.isEnabled(config)) {
      return allTools;
    }

    const allowed = new Set(COORDINATOR_ALLOWED_TOOLS);
    // 额外：允许 mcp__* 中读类工具（非写类的 MCP 工具）
    // MCP 工具以 "mcp__" 为前缀，其中 codegraph_* 已在白名单
    // 其余 MCP 工具如 zotero、qq-mail 等也需要放行读操作
    return allTools.filter((t) => {
      if (allowed.has(t.name)) return true;
      // MCP 工具默认放行（MCP server 自身控制读写权限）
      if (t.name.startsWith("mcp__")) return true;
      return false;
    });
  }
}
