import type { TeamManager } from "./team-manager.js";
import { MailboxSystem } from "./mailbox-system.js";
import type { TeamConfig } from "./types.js";

export async function createTeamWithLead(
  manager: TeamManager,
  teamName: string,
  leadName: string,
): Promise<TeamConfig> {
  const team = await manager.createTeam(teamName, leadName);
  const mailbox = MailboxSystem.fromTeamDir(manager.getTeamDir(teamName));
  await mailbox.registerMember(leadName);
  return team;
}
