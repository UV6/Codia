import type { Tool, ToolContext, ToolInputSchema, ToolResult } from "../tool/types.js";
import type { TeamManager } from "./team-manager.js";
import { createTeamWithLead } from "./create-team.js";

const inputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    teamName: { type: "string", description: "要创建的 team 名称" },
    leadName: { type: "string", description: "Lead 成员名称" },
  },
  required: ["teamName", "leadName"],
};

export function createTeamTool(teamManager: TeamManager): Tool {
  return {
    name: "CreateTeam",
    description: "创建一个新的 team，并初始化 Lead 的邮箱。用户用自然语言要求创建 team 时使用。",
    type: "search",
    readOnly: false,
    destructive: false,
    inputSchema,
    async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      try {
        const team = await createTeamWithLead(
          teamManager,
          params.teamName as string,
          params.leadName as string,
        );
        return {
          status: "success",
          content: JSON.stringify({
            name: team.name,
            lead: team.lead,
            message: `team "${team.name}" 已创建，Lead 为 "${team.lead}"`,
          }, null, 2),
        };
      } catch (error) {
        return {
          status: "error",
          content: (error as Error).message,
        };
      }
    },
  };
}
