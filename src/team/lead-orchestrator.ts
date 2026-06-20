import { execSync } from "node:child_process";
import type { SharedTask, MergeResult, SpawnResult } from "./types.js";
import type { TeamManager } from "./team-manager.js";
import type { SharedTaskBoard } from "./shared-task-board.js";
import type { MailboxSystem } from "./mailbox-system.js";
import type { MemberBackend } from "./member-backend.js";

// LeadOrchestrator —— Lead 专属：目标拆解、派生成员、git 合并
export class LeadOrchestrator {
  private teamManager: TeamManager;
  private taskBoard: SharedTaskBoard;
  private mailbox: MailboxSystem;
  private memberBackend: MemberBackend;
  private projectRoot: string;

  constructor(
    teamManager: TeamManager,
    taskBoard: SharedTaskBoard,
    mailbox: MailboxSystem,
    memberBackend: MemberBackend,
    projectRoot: string,
  ) {
    this.teamManager = teamManager;
    this.taskBoard = taskBoard;
    this.mailbox = mailbox;
    this.memberBackend = memberBackend;
    this.projectRoot = projectRoot;
  }

  // decomposeGoal —— 将用户目标拆解为任务列表
  // 简单实现：按换行分句生成任务，每条一句作为一个独立任务
  // 实际使用时，Lead 本身是 LLM Agent，会构造合适的 prompt
  async decomposeGoal(
    goal: string,
    providedTasks?: Omit<SharedTask, "id" | "createdAt" | "updatedAt">[],
  ): Promise<SharedTask[]> {
    if (providedTasks && providedTasks.length > 0) {
      // 使用 Lead 已构造好的任务列表
      const results: SharedTask[] = [];
      for (const t of providedTasks) {
        const created = await this.taskBoard.createTask(t);
        results.push(created);
      }
      return results;
    }

    // 默认：按句拆解为独立任务
    const sentences = goal
      .split(/[。！？\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (sentences.length === 0) {
      throw new Error("无法从目标中提取任务：目标文本为空");
    }

    const results: SharedTask[] = [];
    for (let i = 0; i < sentences.length; i++) {
      const task = await this.taskBoard.createTask({
        title: `Step ${i + 1}`,
        description: sentences[i],
        status: "pending",
        assignee: null,
        dependencies: i > 0 ? [results[i - 1].id] : [],
      });
      results.push(task);
    }

    return results;
  }

  // spawnMembersForTasks —— 根据任务派生成员
  async spawnMembersForTasks(
    teamName: string,
    tasks: SharedTask[],
  ): Promise<SpawnResult[]> {
    const team = await this.teamManager.loadTeam(teamName);
    const workers = team.members.filter((m) => m.role === "worker");
    const results: SpawnResult[] = [];

    for (let i = 0; i < tasks.length; i++) {
      if (i >= workers.length) {
        throw new Error(
          `任务数 (${tasks.length}) 超过可用 worker 数 (${workers.length})`,
        );
      }

      const worker = workers[i];
      const result = await this.memberBackend.spawnMember(teamName, worker);
      results.push(result);

      // 派发任务消息给成员
      await this.mailbox.sendMessage({
        from: team.lead,
        to: worker.name,
        type: "task_assignment",
        body: JSON.stringify({
          taskId: tasks[i].id,
          title: tasks[i].title,
          description: tasks[i].description,
          dependencies: tasks[i].dependencies,
        }),
        summary: `任务指派: ${tasks[i].title}`,
      });
    }

    return results;
  }

  // mergeAllWorktrees —— 合并所有成员的工作目录
  async mergeAllWorktrees(teamName: string): Promise<MergeResult[]> {
    const team = await this.teamManager.loadTeam(teamName);
    const activeMembers = team.members.filter(
      (m) => m.role === "worker" && m.status !== "stopped",
    );
    // 按名称排序保证合并顺序确定性
    activeMembers.sort((a, b) => a.name.localeCompare(b.name));

    const results: MergeResult[] = [];
    const cwd = this.projectRoot;

    for (const member of activeMembers) {
      try {
        // 检查 worktree 是否有改动
        const branch = `worktree-${teamName}-${member.name}`;
        const result = this.tryMergeMember(branch, cwd, member.name);
        results.push(result);
      } catch (e) {
        results.push({
          memberName: member.name,
          branch: `worktree-${teamName}-${member.name}`,
          status: "rolled_back",
          details: `合并异常: ${(e as Error).message}`,
        });
      }
    }

    // 通知 Lead 合并结果
    const summary = results
      .map(
        (r) =>
          `${r.memberName}: ${r.status === "merged" ? "✓ 已合并" : "✗ 回滚"} - ${r.details}`,
      )
      .join("\n");

    await this.mailbox.sendMessage({
      from: "system",
      to: team.lead,
      type: "text",
      body: JSON.stringify({
        notice: "merge_complete",
        teamName,
        results,
      }),
      summary: `合并完成: ${summary}`,
    });

    return results;
  }

  // tryMergeMember —— 尝试合并单个成员的改动
  private tryMergeMember(
    branch: string,
    cwd: string,
    memberName: string,
  ): MergeResult {
    try {
      // 获取该 worktree 的当前分支
      const currentBranch = execSync("git branch --show-current", {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();

      // fetch 远程
      execSync("git fetch origin", { cwd, stdio: "ignore" });

      // 尝试合并
      execSync(`git merge origin/${branch} --no-edit`, {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });

      return {
        memberName,
        branch,
        status: "merged",
        details: `成功合并 ${branch} 到 ${currentBranch}`,
      };
    } catch (e) {
      // 合并冲突，执行 abort 回滚
      try {
        execSync("git merge --abort", { cwd, stdio: "ignore" });
      } catch {
        // abort 可能也失败（无进行中的合并）
      }
      return {
        memberName,
        branch,
        status: "rolled_back",
        details: `合并冲突，已回滚: ${(e as Error).message}`,
      };
    }
  }

  // rollbackMember —— 回滚单个成员的改动
  async rollbackMember(teamName: string, memberName: string): Promise<void> {
    try {
      execSync("git merge --abort", {
        cwd: this.projectRoot,
        stdio: "ignore",
      });
    } catch {
      // 无进行中的合并
    }
    try {
      execSync("git reset --hard HEAD", {
        cwd: this.projectRoot,
        stdio: "ignore",
      });
    } catch {
      // 忽略
    }

    await this.teamManager.updateMemberStatus(
      teamName,
      memberName,
      "idle",
    );
  }
}
