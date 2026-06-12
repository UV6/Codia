import type { SystemReminder } from "./types.js";
import type { Message } from "../provider/types.js";
import { execSync } from "node:child_process";

// wrapReminder —— 将 SystemReminder 包装为 <system-reminder> XML 文本
export function wrapReminder(reminder: SystemReminder): string {
  return `<system-reminder>\n${reminder.content}\n</system-reminder>`;
}

// reminderToMessage —— 将 SystemReminder 转为 user role 的 Message
export function reminderToMessage(reminder: SystemReminder): Message {
  return {
    role: "user",
    content: wrapReminder(reminder),
    timestamp: new Date().toISOString(),
  };
}

// createEnvInfoProvider —— 创建环境信息 ReminderProvider
// 只在 round=0 时返回非空数组（环境信息仅首轮注入，后续缓存友好）
export function createEnvInfoProvider(cwd: string): (round: number) => SystemReminder[] {
  let envInfoCache: SystemReminder | null = null;

  return (round: number): SystemReminder[] => {
    if (round !== 0) return [];

    if (!envInfoCache) {
      const info: string[] = [];

      // 系统运行环境
      info.push(`操作系统: ${process.platform}`);
      info.push(`Shell: ${process.env.SHELL || "unknown"}`);
      info.push(`日期: ${new Date().toISOString().split("T")[0]}`);
      info.push(`工作目录: ${cwd}`);

      // Git 上下文
      try {
        const gitBranch = execSync("git branch --show-current", {
          cwd,
          encoding: "utf-8",
          timeout: 3000,
        }).trim();
        if (gitBranch) {
          info.push(`Git 分支: ${gitBranch}`);
        }

        const gitLog = execSync('git log --oneline -3', {
          cwd,
          encoding: "utf-8",
          timeout: 3000,
        }).trim();
        if (gitLog) {
          info.push(`最近提交:\n${gitLog}`);
        }

        const gitStatus = execSync("git status --short", {
          cwd,
          encoding: "utf-8",
          timeout: 3000,
        }).trim();
        if (gitStatus) {
          info.push(`未提交变更:\n${gitStatus}`);
        }
      } catch {
        // 非 git 仓库或 git 不可用，跳过
      }

      envInfoCache = {
        source: "env-info",
        content: info.join("\n"),
        round: 0,
      };
    }

    return [envInfoCache];
  };
}

// PLAN_MODE_FULL_PROMPT —— plan mode 下的完整行为约束 prompt
const PLAN_MODE_FULL_PROMPT = `你当前处于 **Plan Mode（计划模式）**。

你不能执行任何修改操作，不能编辑文件、不能提交代码、不能修改配置、不能运行有副作用的命令。
唯一可以写入的文件是下面指定的 plan file。

你的工作流程：
1. 使用 read_file、grep、glob、run_command（仅只读命令）探索代码
2. 分析用户需求，设计实现方案
3. 把执行计划写入 plan file
4. 等待用户确认后再执行`;

// PlanModeReminderProvider —— 管理 Plan Mode 注入节奏
// 首轮完整注入，后续轮次简短标签
export class PlanModeReminderProvider {
  private planFilePath: string;
  private active: boolean = false;
  private activatedAtRound: number = -1;

  constructor(planFilePath: string = "plan.md") {
    this.planFilePath = planFilePath;
  }

  // activate —— 标记进入 plan mode
  activate(round: number): void {
    this.active = true;
    this.activatedAtRound = round;
  }

  // deactivate —— 退出 plan mode
  deactivate(): void {
    this.active = false;
    this.activatedAtRound = -1;
  }

  // isActive —— 当前是否处于 plan mode
  get isActive(): boolean {
    return this.active;
  }

  // getReminders —— 按轮次返回提醒
  getReminders(round: number): SystemReminder[] {
    if (!this.active) return [];

    if (round === this.activatedAtRound) {
      // 首轮：完整 plan mode 提示
      return [
        {
          source: "plan-mode",
          content: `${PLAN_MODE_FULL_PROMPT}\n\nplan file 路径：${this.planFilePath}`,
          round,
        },
      ];
    }

    // 后续轮次：简短标签
    return [
      {
        source: "plan-mode",
        content: `Plan Mode 已激活，plan file: ${this.planFilePath}`,
        round,
      },
    ];
  }

  // toProvider —— 适配为 ReminderProvider 函数类型
  toProvider(): (round: number) => SystemReminder[] {
    return (round: number) => this.getReminders(round);
  }
}
