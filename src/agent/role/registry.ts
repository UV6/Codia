import { join } from "node:path";
import { homedir } from "node:os";
import type { AgentRole } from "./types.js";
import { builtinRoles } from "./builtin.js";
import { loadFromDir } from "./loader.js";

// AgentRoleRegistry —— 角色注册中心，四级优先级加载与合并
export class AgentRoleRegistry {
  private roles = new Map<string, AgentRole>();
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  // reload —— 重新扫描所有来源，按优先级合并
  // 优先级：内置 < 插件 < 用户 < 项目，后者覆盖前者
  reload(pluginDir?: string): void {
    this.roles.clear();

    // 第一级：内置角色（最低优先级）
    for (const role of builtinRoles) {
      this.roles.set(role.frontmatter.name, role);
    }

    // 第二级：插件级
    if (pluginDir) {
      const pluginRoles = loadFromDir(pluginDir, "plugin");
      for (const role of pluginRoles) {
        this.roles.set(role.frontmatter.name, role);
      }
    }

    // 第三级：用户级（~/.codia/agents/）
    const userDir = join(homedir(), ".codia", "agents");
    const userRoles = loadFromDir(userDir, "user");
    for (const role of userRoles) {
      this.roles.set(role.frontmatter.name, role);
    }

    // 第四级：项目级（$PROJECT/.codia/agents/）
    const projectDir = join(this.projectRoot, ".codia", "agents");
    const projectRoles = loadFromDir(projectDir, "project");
    for (const role of projectRoles) {
      this.roles.set(role.frontmatter.name, role);
    }
  }

  // resolve —— 按名查找，返回优先级合并后的最终角色
  resolve(name: string): AgentRole | null {
    return this.roles.get(name) ?? null;
  }

  // list —— 列出当前所有可用角色
  list(): AgentRole[] {
    return Array.from(this.roles.values());
  }

  // getBuiltinRoles —— 返回内置角色清单
  getBuiltinRoles(): AgentRole[] {
    return builtinRoles;
  }
}
