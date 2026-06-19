import type { CommandDef } from "./types.js";

// CommandRegistry —— 命令注册中心
// 管理所有命令的注册、查找、冲突检测和前缀匹配
export class CommandRegistry {
  private commands = new Map<string, CommandDef>();
  private aliases = new Map<string, string>(); // alias → name

  // register —— 注册命令，冲突时 throw
  register(cmd: CommandDef): void {
    // 校验名称
    if (this.commands.has(cmd.name)) {
      throw new Error(`命令 "${cmd.name}" 已注册`);
    }

    // 校验别名
    if (cmd.aliases) {
      // 别名数组自身去重校验
      const seen = new Set<string>();
      for (const alias of cmd.aliases) {
        if (alias.length === 0) {
          throw new Error(`命令 "${cmd.name}" 的别名列表包含空字符串`);
        }
        if (seen.has(alias)) {
          throw new Error(`命令 "${cmd.name}" 的别名 "${alias}" 重复`);
        }
        seen.add(alias);

        // 检查别名是否与已有名称冲突
        if (this.commands.has(alias)) {
          throw new Error(`别名 "${alias}" 与已有命令名冲突`);
        }
        // 检查别名是否与已有别名冲突
        if (this.aliases.has(alias)) {
          throw new Error(`别名 "${alias}" 已被命令 "${this.aliases.get(alias)}" 使用`);
        }
      }
    }

    // 写入
    this.commands.set(cmd.name, cmd);
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        this.aliases.set(alias, cmd.name);
      }
    }
  }

  // get —— 按名称或别名查找命令
  get(nameOrAlias: string): CommandDef | undefined {
    // 先查主名
    const cmd = this.commands.get(nameOrAlias);
    if (cmd) return cmd;

    // 再查别名
    const name = this.aliases.get(nameOrAlias);
    if (name) return this.commands.get(name);

    return undefined;
  }

  // getAll —— 返回所有非隐藏命令
  getAll(): CommandDef[] {
    const result: CommandDef[] = [];
    for (const cmd of this.commands.values()) {
      if (!cmd.hidden) {
        result.push(cmd);
      }
    }
    return result;
  }

  // getMatches —— 前缀匹配，用于 Tab 补全
  // 匹配主名和别名，去重后返回，排除隐藏命令
  getMatches(prefix: string): CommandDef[] {
    const lower = prefix.toLowerCase();
    const found = new Map<string, CommandDef>();

    // 匹配主名
    for (const [name, cmd] of this.commands) {
      if (!cmd.hidden && name.toLowerCase().startsWith(lower)) {
        found.set(name, cmd);
      }
    }

    // 匹配别名
    for (const [alias, name] of this.aliases) {
      if (alias.toLowerCase().startsWith(lower)) {
        const cmd = this.commands.get(name);
        if (cmd && !cmd.hidden) {
          found.set(name, cmd);
        }
      }
    }

    return Array.from(found.values());
  }
}
