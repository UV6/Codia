// 团队系统 —— 公共导出
export { TeamManager, DEFAULT_TEAMS_ROOT } from "./team-manager.js";
export { createTeamWithLead } from "./create-team.js";
export { createTeamTool } from "./create-team-tool.js";
export { SharedTaskBoard } from "./shared-task-board.js";
export { MailboxSystem, withFileLock } from "./mailbox-system.js";
export { MemberBackend } from "./member-backend.js";
export { LeadOrchestrator } from "./lead-orchestrator.js";
export { CoordinatorFilter } from "./coordinator-filter.js";
export { createTeamTools } from "./team-tools.js";
export type {
  TeamConfig,
  MemberInfo,
  SharedTask,
  TeamMessage,
  ApprovalResponse,
  SpawnResult,
  MergeResult,
} from "./types.js";
