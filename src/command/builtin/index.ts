import { helpCommand } from "./help.js";
import { compactCommand } from "./compact.js";
import { clearCommand } from "./clear.js";
import { planCommand } from "./plan.js";
import { doCommand } from "./do.js";
import { sessionCommand } from "./session.js";
import { memoryCommand } from "./memory.js";
import { permissionCommand } from "./permission.js";
import { statusCommand } from "./status.js";
import { contextCommand } from "./context.js";
import { acceptsEditCommand } from "./acceptsedit.js";
import { defaultCommand } from "./default.js";
import { bypassCommand } from "./bypass.js";
import { skillsCommand } from "./skills.js";
import type { CommandDef } from "../types.js";
import type { SkillSummary } from "../../skill/types.js";

// NON_SKILL_COMMANDS —— 非 Skill 的命令（help、compact、clear 等）
const NON_SKILL_COMMANDS: CommandDef[] = [
  helpCommand,
  compactCommand,
  clearCommand,
  planCommand,
  doCommand,
  sessionCommand,
  memoryCommand,
  permissionCommand,
  statusCommand,
  contextCommand,
  acceptsEditCommand,
  defaultCommand,
  bypassCommand,
  skillsCommand,
];

// buildSkillCommands —— 从 Skill 摘要列表生成 CommandDef
export function buildSkillCommands(skills: SkillSummary[]): CommandDef[] {
  return skills.map((s) => ({
    name: s.name,
    aliases: s.aliases,
    description: s.description,
    type: "prompt" as const,
    promptText: `请调用 LoadSkill 工具，加载 "${s.name}" Skill。`,
    handler: () => {}, // prompt 型由 dispatcher 取 promptText
  }));
}

// getBuiltinCommands —— 获取完整命令列表（非 Skill + Skill 命令）
export function getBuiltinCommands(skills: SkillSummary[]): CommandDef[] {
  return [...NON_SKILL_COMMANDS, ...buildSkillCommands(skills)];
}
