import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AgentRole, AgentRoleFrontmatter } from "./types.js";

// FRONTMATTER_REGEX —— 匹配 YAML frontmatter（--- ... ---）
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

// loadFromDir —— 扫描指定目录下的所有 .md 文件，解析为 AgentRole 列表
export function loadFromDir(
  dir: string,
  source: "user" | "project" | "plugin",
): AgentRole[] {
  const roles: AgentRole[] = [];

  if (!existsSync(dir)) return roles;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return roles;
  }

  for (const entry of entries) {
    if (extname(entry) !== ".md") continue;

    const filePath = join(dir, entry);
    let isFile: boolean;
    try {
      isFile = statSync(filePath).isFile();
    } catch {
      continue;
    }
    if (!isFile) continue;

    const role = parseRoleFile(filePath, source);
    if (!role) {
      console.warn(`[AgentRole] 文件 "${entry}" 解析失败（frontmatter 格式错误或缺少必填字段）`);
      continue;
    }

    roles.push(role);
  }

  // 按文件名排序，保证加载顺序确定
  roles.sort((a, b) => {
    const nameA = a.filePath ?? "";
    const nameB = b.filePath ?? "";
    return nameA.localeCompare(nameB);
  });

  return roles;
}

// parseRoleFile —— 解析单个角色 Markdown 文件
export function parseRoleFile(
  filePath: string,
  source: "builtin" | "plugin" | "user" | "project",
): AgentRole | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const match = raw.match(FRONTMATTER_REGEX);
    if (!match) return null;

    const [, yamlBlock, body] = match;
    const fm = parseYaml(yamlBlock) as Record<string, unknown>;

    // 校验必填字段
    if (!fm || typeof fm !== "object") return null;
    if (typeof fm.name !== "string" || fm.name.length === 0) return null;
    if (typeof fm.description !== "string" || fm.description.length === 0) return null;

    // 校验可选字段类型
    if (fm.model !== undefined && typeof fm.model !== "string") return null;
    if (fm.maxRounds !== undefined && typeof fm.maxRounds !== "number") return null;
    if (fm.tools !== undefined && !Array.isArray(fm.tools)) return null;
    if (fm.disallowedTools !== undefined && !Array.isArray(fm.disallowedTools)) return null;

    // 校验 model 合法值
    const validModels = ["inherit", "haiku", "sonnet", "opus"];
    const modelVal = fm.model as string | undefined;
    if (modelVal && !validModels.includes(modelVal)) return null;

    // 校验 permissionMode 合法值
    const validModes = ["default", "acceptsEdit", "plan", "bypassPermissions"];
    const permVal = fm.permissionMode as string | undefined;
    if (permVal && !validModes.includes(permVal)) return null;

    // 校验 isolation 合法值
    const validIsolations = ["worktree"];
    const isolationVal = fm.isolation as string | undefined;
    if (isolationVal && !validIsolations.includes(isolationVal)) return null;

    const frontmatter: AgentRoleFrontmatter = {
      name: fm.name as string,
      description: fm.description as string,
      model: modelVal as AgentRoleFrontmatter["model"],
      maxRounds: fm.maxRounds as number | undefined,
      permissionMode: permVal as AgentRoleFrontmatter["permissionMode"],
      tools: fm.tools as string[] | undefined,
      disallowedTools: fm.disallowedTools as string[] | undefined,
      isolation: isolationVal as AgentRoleFrontmatter["isolation"],
    };

    return {
      source,
      frontmatter,
      body: body.trim(),
      filePath,
    };
  } catch {
    return null;
  }
}
