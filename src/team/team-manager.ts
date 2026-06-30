import { mkdirSync, readFileSync, readdirSync, existsSync, rmSync, renameSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { TeamConfig, MemberInfo } from "./types.js";
import { getTeamsRoot } from "../storage/paths.js";

// 默认持久化根目录
export const DEFAULT_TEAMS_ROOT = getTeamsRoot();

// TeamManager —— 小组的创建、加载、更新、删除，成员花名册管理
export class TeamManager {
  private persistenceRoot: string;

  constructor(persistenceRoot?: string) {
    this.persistenceRoot = persistenceRoot ?? getTeamsRoot();
  }

  // group.json 路径
  private groupPath(teamName: string): string {
    return join(this.persistenceRoot, teamName, "group.json");
  }

  // 原子写入 JSON 文件（先写 .tmp 再 rename）
  private async atomicWrite(filePath: string, data: unknown): Promise<void> {
    const tmpPath = filePath + ".tmp";
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmpPath, filePath);
  }

  // createTeam —— 创建新小组
  async createTeam(name: string, leadName: string): Promise<TeamConfig> {
    const teamDir = join(this.persistenceRoot, name);
    if (existsSync(this.groupPath(name))) {
      throw new Error(`小组 "${name}" 已存在`);
    }
    mkdirSync(teamDir, { recursive: true });
    mkdirSync(join(teamDir, "members", "mailbox"), { recursive: true });

    const now = new Date().toISOString();
    const config: TeamConfig = {
      name,
      lead: leadName,
      members: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.atomicWrite(this.groupPath(name), config);
    return config;
  }

  // loadTeam —— 从磁盘加载已有小组
  async loadTeam(name: string): Promise<TeamConfig> {
    const path = this.groupPath(name);
    if (!existsSync(path)) {
      throw new Error(`小组 "${name}" 不存在（路径：${path}）`);
    }
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as TeamConfig;
  }

  // listTeams —— 列出所有小组名称
  async listTeams(): Promise<string[]> {
    if (!existsSync(this.persistenceRoot)) {
      return [];
    }
    return readdirSync(this.persistenceRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(d.parentPath ?? this.persistenceRoot, d.name, "group.json")))
      .map((d) => d.name);
  }

  // saveTeam —— 保存小组配置（原子写入）
  async saveTeam(config: TeamConfig): Promise<void> {
    config.updatedAt = new Date().toISOString();
    // 确保目录存在
    const teamDir = dirname(this.groupPath(config.name));
    if (!existsSync(teamDir)) {
      throw new Error(`小组目录不存在：${teamDir}`);
    }
    await this.atomicWrite(this.groupPath(config.name), config);
  }

  // deleteTeam —— 删除小组
  async deleteTeam(name: string): Promise<void> {
    const teamDir = join(this.persistenceRoot, name);
    if (existsSync(teamDir)) {
      rmSync(teamDir, { recursive: true, force: true });
    }
  }

  // addMember —— 添加成员
  async addMember(teamName: string, info: MemberInfo): Promise<void> {
    const config = await this.loadTeam(teamName);
    // 重名检查
    if (config.members.some((m) => m.name === info.name)) {
      throw new Error(`成员 "${info.name}" 已存在`);
    }
    config.members.push(info);
    await this.saveTeam(config);
  }

  // removeMember —— 移除成员
  async removeMember(teamName: string, memberName: string): Promise<void> {
    const config = await this.loadTeam(teamName);
    config.members = config.members.filter((m) => m.name !== memberName);
    await this.saveTeam(config);
  }

  // updateMemberStatus —— 更新成员状态
  async updateMemberStatus(
    teamName: string,
    memberName: string,
    status: MemberInfo["status"],
  ): Promise<void> {
    const config = await this.loadTeam(teamName);
    const member = config.members.find((m) => m.name === memberName);
    if (!member) {
      throw new Error(`成员 "${memberName}" 不存在`);
    }
    member.status = status;
    await this.saveTeam(config);
  }

  // getTeamDir —— 获取小组目录路径
  getTeamDir(teamName: string): string {
    return join(this.persistenceRoot, teamName);
  }

  // getPersistenceRoot —— 获取持久化根目录
  getPersistenceRoot(): string {
    return this.persistenceRoot;
  }

  // updateMember —— 更新成员属性（通用）
  async updateMember(
    teamName: string,
    memberName: string,
    patch: Partial<Pick<MemberInfo, "workDir" | "backend" | "requiresApproval" | "status" | "sessionId">>,
  ): Promise<void> {
    const config = await this.loadTeam(teamName);
    const member = config.members.find((m) => m.name === memberName);
    if (!member) {
      throw new Error(`成员 "${memberName}" 不存在`);
    }
    Object.assign(member, patch);
    await this.saveTeam(config);
  }
}
