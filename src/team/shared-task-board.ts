import { readFileSync, existsSync, renameSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SharedTask } from "./types.js";

// SharedTaskBoard —— 共享任务板，JSON 文件持久化
export class SharedTaskBoard {
  private tasksPath: string;

  constructor(teamDir: string) {
    this.tasksPath = join(teamDir, "tasks.json");
  }

  // load —— 从 tasks.json 读取任务数组
  private load(): SharedTask[] {
    if (!existsSync(this.tasksPath)) {
      return [];
    }
    const raw = readFileSync(this.tasksPath, "utf-8");
    return JSON.parse(raw) as SharedTask[];
  }

  // save —— 原子写入 tasks.json
  private async save(tasks: SharedTask[]): Promise<void> {
    const tmpPath = this.tasksPath + ".tmp";
    await writeFile(tmpPath, JSON.stringify(tasks, null, 2), "utf-8");
    renameSync(tmpPath, this.tasksPath);
  }

  // createTask —— 创建任务
  async createTask(
    task: Omit<SharedTask, "id" | "createdAt" | "updatedAt">,
  ): Promise<SharedTask> {
    const now = new Date().toISOString();
    const full: SharedTask = {
      ...task,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const tasks = this.load();
    tasks.push(full);
    await this.save(tasks);
    return full;
  }

  // getTask —— 获取单个任务
  async getTask(taskId: string): Promise<SharedTask | null> {
    const tasks = this.load();
    return tasks.find((t) => t.id === taskId) ?? null;
  }

  // listTasks —— 列出任务，可按 status/assignee 过滤
  async listTasks(
    filter?: { status?: string; assignee?: string },
  ): Promise<SharedTask[]> {
    let tasks = this.load();
    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }
    if (filter?.assignee) {
      tasks = tasks.filter((t) => t.assignee === filter.assignee);
    }
    return tasks;
  }

  // updateTask —— 更新任务
  async updateTask(
    taskId: string,
    patch: Partial<Omit<SharedTask, "id" | "createdAt">>,
  ): Promise<SharedTask> {
    const tasks = this.load();
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) {
      throw new Error(`任务 "${taskId}" 不存在`);
    }
    const updated = { ...tasks[idx], ...patch, updatedAt: new Date().toISOString() } as SharedTask;
    // 确保 id 和 createdAt 不被 patch 覆盖
    updated.id = tasks[idx].id;
    updated.createdAt = tasks[idx].createdAt;
    tasks[idx] = updated;
    await this.save(tasks);
    return updated;
  }

  // deleteTask —— 删除任务
  async deleteTask(taskId: string): Promise<void> {
    const tasks = this.load();
    const filtered = tasks.filter((t) => t.id !== taskId);
    if (filtered.length === tasks.length) {
      throw new Error(`任务 "${taskId}" 不存在`);
    }
    await this.save(filtered);
  }

  // getReadyTasks —— 获取可执行的任务（状态 pending 且所有依赖已完成）
  async getReadyTasks(): Promise<SharedTask[]> {
    const tasks = this.load();
    return tasks.filter((t) => {
      if (t.status !== "pending") return false;
      if (t.dependencies.length === 0) return true;
      return t.dependencies.every((depId) => {
        const dep = tasks.find((dt) => dt.id === depId);
        return dep?.status === "completed";
      });
    });
  }
}
