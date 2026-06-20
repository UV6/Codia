import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import type { MemberInfo, SpawnResult } from "./types.js";
import type { TeamManager } from "./team-manager.js";
import type { MailboxSystem } from "./mailbox-system.js";

// MemberBackend —— 成员运行时后端：tmux 隔离 / in-process 轻量
export class MemberBackend {
  private teamManager: TeamManager;
  private mailbox: MailboxSystem;

  constructor(teamManager: TeamManager, mailbox: MailboxSystem) {
    this.teamManager = teamManager;
    this.mailbox = mailbox;
  }

  // isTmuxAvailable —— 检测 tmux 是否可用
  isTmuxAvailable(): boolean {
    try {
      // 检查 tmux 命令是否存在
      execSync("which tmux", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  // detectAvailable —— 检测可用的后端类型
  detectAvailable(): "tmux" | "in-process" {
    return this.isTmuxAvailable() ? "tmux" : "in-process";
  }

  // spawnMember —— 派生一个成员
  async spawnMember(
    teamName: string,
    info: MemberInfo,
  ): Promise<SpawnResult> {
    const tmuxAvailable = this.isTmuxAvailable();
    let sessionId: string | null = null;
    let degraded = false;
    let degradeReason: string | undefined;

    // 确保工作目录存在
    mkdirSync(info.workDir, { recursive: true });

    if (tmuxAvailable) {
      // TMux 模式：尝试创建 tmux session
      const sessionName = `codia-${teamName}-${info.name}`;
      try {
        execSync(
          `tmux new-session -d -s "${sessionName}" -c "${info.workDir}"`,
          { stdio: "ignore" },
        );
        sessionId = sessionName;

        await this.teamManager.updateMember(teamName, info.name, {
          status: "active",
          backend: "tmux",
          sessionId: sessionName,
          workDir: info.workDir,
        });
      } catch (e) {
        // TMux session 创建失败，降级通知
        degraded = true;
        degradeReason = `tmux session 创建失败: ${(e as Error).message}，回退到 in-process`;
        sessionId = `proc-${process.pid}`;
        await this.teamManager.updateMember(teamName, info.name, {
          status: "active",
          backend: "in-process",
          sessionId,
          workDir: info.workDir,
        });
      }
    } else {
      // tmux 不可用，直接 in-process
      degraded = true;
      degradeReason = "tmux 不可用，使用 in-process 模式";
      sessionId = `proc-${process.pid}`;
      await this.teamManager.updateMember(teamName, info.name, {
        status: "active",
        backend: "in-process",
        sessionId,
        workDir: info.workDir,
      });
    }

    // 降级时通知 Lead
    if (degraded) {
      const team = await this.teamManager.loadTeam(teamName);
      await this.mailbox.sendMessage({
        from: "system",
        to: team.lead,
        type: "text",
        body: JSON.stringify({
          notice: "backend_degraded",
          member: info.name,
          reason: degradeReason,
          backend: "in-process",
        }),
        summary: `成员 ${info.name} 后端降级通知`,
      });
    }

    return {
      memberName: info.name,
      backend: degraded ? "in-process" : "tmux",
      degraded,
      degradeReason,
      sessionId,
      workDir: info.workDir,
    };
  }

  // stopMember —— 终止一个成员
  async stopMember(teamName: string, memberName: string): Promise<void> {
    const team = await this.teamManager.loadTeam(teamName);
    const member = team.members.find((m) => m.name === memberName);
    if (!member) {
      throw new Error(`成员 "${memberName}" 不存在`);
    }

    if (member.backend === "tmux" && member.sessionId) {
      try {
        execSync(`tmux kill-session -t "${member.sessionId}"`, {
          stdio: "ignore",
        });
      } catch {
        // session 可能已经不存在
      }
    }
    // in-process 的终止由外部通过 AbortSignal 控制

    await this.teamManager.updateMemberStatus(teamName, memberName, "stopped");
  }

  // wakeMember —— 唤醒 tmux 窗格
  async wakeMember(teamName: string, memberName: string): Promise<void> {
    const team = await this.teamManager.loadTeam(teamName);
    const member = team.members.find((m) => m.name === memberName);
    if (!member) {
      throw new Error(`成员 "${memberName}" 不存在`);
    }

    if (member.backend === "tmux" && member.sessionId) {
      try {
        execSync(`tmux select-window -t "${member.sessionId}"`, {
          stdio: "ignore",
        });
      } catch {
        // session 可能已退出
      }
    }
  }
}
