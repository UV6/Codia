import type { Tool, ToolInputSchema, ToolResult, ToolContext } from "../types.js";
import type { SkillActivator } from "../../skill/activator.js";

// createLoadSkillTool —— 创建 LoadSkill 工具（注入 activator）
export function createLoadSkillTool(activator: SkillActivator): Tool {
  const inputSchema: ToolInputSchema = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "要加载的 Skill 名称",
      },
      args: {
        type: "string",
        description: "传递给 Skill 的参数，空格分隔。如 'hello world' 会将 hello 替换为 {{arg1}}，world 替换为 {{arg2}}",
      },
    },
    required: ["name"],
  };

  return {
    name: "LoadSkill",
    description:
      "按需加载一个 Skill 的完整指令和专属工具。传入 Skill 名字（可选参数），返回 SOP 正文。" +
      "Skill 加载后其指令会钉在上下文顶部，可供后续所有对话轮次使用。" +
      "可用的 Skill 列表见 system prompt 中的「可用 Skill」节。",
    type: "search",
    readOnly: true,
    destructive: false,
    inputSchema,

    async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const name = params.name as string;
      let args: string[] | undefined;

      if (params.args && typeof params.args === "string") {
        args = (params.args as string).trim().split(/\s+/);
      }

      const result = activator.loadSkill(name, args);

      if (!result) {
        return {
          status: "error",
          content: `未找到 Skill "${name}"。可用 Skill 列表请参考 system prompt 中的「可用 Skill」节。`,
        };
      }

      const modeNote =
        result.mode === "fork"
          ? "\n\n此 Skill 以 Fork 模式执行——会在独立对话上下文中运行，执行完毕后仅将摘要回流到主对话。"
          : "\n\n此 Skill 以 Inline 模式执行——在当前对话上下文中直接运行。";

      return {
        status: "success",
        content:
          `Skill "${result.name}" 已加载。\n\n## 指令正文\n\n${result.body}` +
          (result.resources.length > 0
            ? `\n\n## 附属资源\n${result.resources.join("\n")}`
            : "") +
          modeNote,
      };
    },
  };
}
