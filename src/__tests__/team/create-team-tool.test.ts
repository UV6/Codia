import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { TeamManager } from "../../team/team-manager.js";
import { createTeamTool } from "../../team/create-team-tool.js";
import { MailboxSystem } from "../../team/mailbox-system.js";

describe("CreateTeamTool", () => {
  let tmpDir: string;
  let manager: TeamManager;

  beforeEach(() => {
    const id = randomUUID().slice(0, 8);
    tmpDir = join(tmpdir(), `codia-test-create-team-tool-${id}`);
    mkdirSync(tmpDir, { recursive: true });
    manager = new TeamManager(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("创建 team 并初始化 lead 邮箱", async () => {
    const tool = createTeamTool(manager);

    const result = await tool.execute(
      { teamName: "alpha", leadName: "alice" },
      { cwd: tmpDir, signal: new AbortController().signal },
    );

    expect(result.status).toBe("success");

    const team = await manager.loadTeam("alpha");
    expect(team.name).toBe("alpha");
    expect(team.lead).toBe("alice");

    const mailbox = MailboxSystem.fromTeamDir(manager.getTeamDir("alpha"));
    const inbox = await mailbox.readInbox("alice");
    expect(inbox).toEqual([]);
  });

  it("重复创建同名 team 返回 error", async () => {
    const tool = createTeamTool(manager);

    await tool.execute(
      { teamName: "alpha", leadName: "alice" },
      { cwd: tmpDir, signal: new AbortController().signal },
    );

    const result = await tool.execute(
      { teamName: "alpha", leadName: "bob" },
      { cwd: tmpDir, signal: new AbortController().signal },
    );

    expect(result.status).toBe("error");
    expect(result.content).toContain("已存在");
  });
});
