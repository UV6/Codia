import { readFileSync, existsSync, statSync, renameSync, unlinkSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { TeamMessage } from "./types.js";

// sleep —— 异步延迟
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// cleanupStaleLock —— 检查并清理过期锁文件
// 在尝试获取锁失败后调用，如果锁文件的 mtime 超过 ttlMs 则删除
async function cleanupStaleLock(
  lockPath: string,
  lockTtlMs: number,
): Promise<void> {
  try {
    const stat = statSync(lockPath);
    const age = Date.now() - stat.mtimeMs;
    if (age > lockTtlMs) {
      await unlink(lockPath).catch(() => {});
    }
  } catch {
    // 锁文件已不存在，无需清理
  }
}

// withFileLock —— 文件锁保护，支持重试和过期锁清理
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  maxRetries = 5,
  lockTtlMs = 30000,
): Promise<T> {
  const lockPath = filePath + ".lock";

  for (let i = 0; i < maxRetries; i++) {
    try {
      // 确保锁文件所在目录存在
      const lockDir = dirname(lockPath);
      if (!existsSync(lockDir)) {
        mkdirSync(lockDir, { recursive: true });
      }
      // 尝试创建锁文件（wx 保证原子性）
      await writeFile(lockPath, String(process.pid), { flag: "wx" });
      break;
    } catch {
      // 创建失败（锁已存在）：检查并清理过期锁
      await cleanupStaleLock(lockPath, lockTtlMs);
      if (i === maxRetries - 1) {
        throw new Error(`获取锁失败，已达最大重试次数：${lockPath}`);
      }
      await sleep(50 * (i + 1)); // 递增等待：50ms, 100ms, 150ms...
    }
  }

  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // 锁文件可能已被清理
    }
  }
}

// MailboxSystem —— 名称注册表 + 邮箱文件 + 锁机制 + 结构化消息
export class MailboxSystem {
  private membersDir: string;
  private registryPath: string;
  private mailboxDir: string;

  // 工厂方法：从团队目录路径构造（推荐）
  static fromTeamDir(teamDir: string): MailboxSystem {
    return new MailboxSystem(teamDir);
  }

  constructor(teamDir: string) {
    this.membersDir = join(teamDir, "members");
    this.registryPath = join(this.membersDir, "registry.json");
    this.mailboxDir = join(this.membersDir, "mailbox");
    // 确保目录存在
    if (!existsSync(this.mailboxDir)) {
      mkdirSync(this.mailboxDir, { recursive: true });
    }
  }

  // loadRegistry —— 加载名称注册表
  private loadRegistry(): Record<string, string> {
    if (!existsSync(this.registryPath)) {
      return {};
    }
    const raw = readFileSync(this.registryPath, "utf-8");
    return JSON.parse(raw) as Record<string, string>;
  }

  // saveRegistry —— 保存名称注册表
  private async saveRegistry(registry: Record<string, string>): Promise<void> {
    const tmpPath = this.registryPath + ".tmp";
    await writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
    renameSync(tmpPath, this.registryPath);
  }

  // registerMember —— 注册成员邮箱
  async registerMember(name: string): Promise<void> {
    const mailboxPath = join(this.mailboxDir, `${name}.json`);
    const registry = this.loadRegistry();
    registry[name] = mailboxPath;
    await this.saveRegistry(registry);

    // 创建空邮箱文件
    if (!existsSync(mailboxPath)) {
      await writeFile(mailboxPath, "[]", "utf-8");
    }
  }

  // unregisterMember —— 注销成员邮箱
  async unregisterMember(name: string): Promise<void> {
    const registry = this.loadRegistry();
    delete registry[name];
    await this.saveRegistry(registry);
  }

  // getMailboxPath —— 获取成员邮箱路径
  private getMailboxPath(memberName: string): string {
    const registry = this.loadRegistry();
    const path = registry[memberName];
    if (!path) {
      throw new Error(`成员 "${memberName}" 未注册`);
    }
    return path;
  }

  // loadMailbox —— 加载邮箱
  private loadMailbox(memberName: string): TeamMessage[] {
    const path = this.getMailboxPath(memberName);
    if (!existsSync(path)) {
      return [];
    }
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as TeamMessage[];
  }

  // saveMailbox —— 保存邮箱（需在锁内使用）
  private async saveMailboxUnsafe(memberName: string, messages: TeamMessage[]): Promise<void> {
    const path = this.getMailboxPath(memberName);
    const tmpPath = path + ".tmp";
    await writeFile(tmpPath, JSON.stringify(messages, null, 2), "utf-8");
    renameSync(tmpPath, path);
  }

  // sendMessage —— 发送消息
  async sendMessage(
    msg: Omit<TeamMessage, "id" | "timestamp" | "read">,
  ): Promise<TeamMessage> {
    const message: TeamMessage = {
      ...msg,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      read: false,
    };

    if (msg.to === "*") {
      // 广播：给所有注册成员发送
      const registry = this.loadRegistry();
      for (const name of Object.keys(registry)) {
        if (name !== msg.from) {
          await this.deliverTo(name, message);
        }
      }
    } else {
      await this.deliverTo(msg.to, message);
    }

    return message;
  }

  // deliverTo —— 向指定成员投递消息
  private async deliverTo(
    memberName: string,
    message: TeamMessage,
  ): Promise<void> {
    const path = this.getMailboxPath(memberName);
    await withFileLock(path, async () => {
      const messages = this.loadMailbox(memberName);
      // 广播时 from/to 修正
      const delivered = { ...message };
      if (message.to === "*") {
        delivered.to = memberName;
      }
      messages.push(delivered);
      await this.saveMailboxUnsafe(memberName, messages);
    });
  }

  // broadcast —— 发送广播
  async broadcast(
    from: string,
    body: string,
    summary: string,
  ): Promise<TeamMessage[]> {
    const results: TeamMessage[] = [];
    const registry = this.loadRegistry();
    for (const name of Object.keys(registry)) {
      if (name !== from) {
        const msg = await this.sendMessage({
          from,
          to: name,
          type: "broadcast",
          body,
          summary,
        });
        results.push(msg);
      }
    }
    return results;
  }

  // readInbox —— 读取收件箱
  async readInbox(
    memberName: string,
    markAsRead = false,
  ): Promise<TeamMessage[]> {
    const path = this.getMailboxPath(memberName);
    return withFileLock(path, async () => {
      const messages = this.loadMailbox(memberName);
      if (markAsRead) {
        for (const m of messages) {
          if (!m.read) {
            m.read = true;
          }
        }
        await this.saveMailboxUnsafe(memberName, messages);
      }
      // 返回所有消息（按时间排序）
      return [...messages].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
    });
  }

  // getMessage —— 按 ID 获取单条消息
  async getMessage(
    memberName: string,
    messageId: string,
  ): Promise<TeamMessage | null> {
    const messages = this.loadMailbox(memberName);
    return messages.find((m) => m.id === messageId) ?? null;
  }

  // markAsRead —— 标记消息已读
  async markAsRead(memberName: string, messageId: string): Promise<void> {
    const path = this.getMailboxPath(memberName);
    await withFileLock(path, async () => {
      const messages = this.loadMailbox(memberName);
      const msg = messages.find((m) => m.id === messageId);
      if (msg) {
        msg.read = true;
        await this.saveMailboxUnsafe(memberName, messages);
      }
    });
  }
}
