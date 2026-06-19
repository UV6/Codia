import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename, extname, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { Skill, SkillSummary, SkillDiagnostic, SkillSource, SkillFrontmatter } from "./types.js";

// BUILTIN_SKILLS_DIR —— 内置 Skill 目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BUILTIN_SKILLS_DIR = join(__dirname, "builtin");

// FRONTMATTER_REGEX —— 匹配 YAML frontmatter（--- ... ---）
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

// getDirs —— 返回三层 Skill 目录路径
export function getDirs(projectRoot: string): { builtin: string; user: string; project: string } {
  return {
    builtin: BUILTIN_SKILLS_DIR,
    user: join(homedir(), ".codia", "skills"),
    project: join(projectRoot, ".codia", "skills"),
  };
}

// parseSkillFile —— 解析单个 Skill 文件
// 返回 Skill 对象，失败返回 null
export function parseSkillFile(
  filePath: string,
  source: SkillSource,
  dir?: string,
): Skill | null {
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
    if (fm.mode !== "inline" && fm.mode !== "fork") return null;

    // 校验可选字段类型
    if (fm.allowedTools !== undefined && !Array.isArray(fm.allowedTools)) return null;
    if (fm.aliases !== undefined && !Array.isArray(fm.aliases)) return null;

    const frontmatter: SkillFrontmatter = {
      name: fm.name as string,
      description: fm.description as string,
      mode: fm.mode as "inline" | "fork",
      allowedTools: fm.allowedTools as string[] | undefined,
      aliases: fm.aliases as string[] | undefined,
      historyRounds: typeof fm.historyRounds === "number" ? fm.historyRounds : undefined,
      model: typeof fm.model === "string" ? fm.model : undefined,
    };

    return {
      source,
      dir: dir ?? "",
      frontmatter,
      body: body.trim(),
    };
  } catch {
    return null;
  }
}

// scanDir —— 扫描单层 Skill 目录
export function scanDir(
  dirPath: string,
  source: SkillSource,
): { skills: Skill[]; diagnostics: SkillDiagnostic[] } {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];

  if (!existsSync(dirPath)) return { skills, diagnostics };

  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return { skills, diagnostics };
  }

  const seenNames = new Set<string>();
  const dirSkills = new Map<string, string>(); // name → dir path (目录型)

  // 第一遍：收集目录型 Skill（name/skill.md）
  for (const entry of entries) {
    const entryPath = join(dirPath, entry);
    try {
      if (!statSync(entryPath).isDirectory()) continue;
    } catch {
      continue;
    }
    const skillMdPath = join(entryPath, "skill.md");
    if (existsSync(skillMdPath)) {
      const skill = parseSkillFile(skillMdPath, source, entryPath);
      if (skill) {
        // frontmatter name 优先，否则用目录名
        const name = skill.frontmatter.name || entry;
        skills.push(skill);
        seenNames.add(name);
        dirSkills.set(name, entryPath);
      } else {
        diagnostics.push({
          filePath: skillMdPath,
          level: "warning",
          message: `目录型 Skill "${entry}" 入口文件解析失败`,
        });
      }
    }
  }

  // 第二遍：处理单文件 .md（排除目录型里已占用的）
  for (const entry of entries) {
    const entryPath = join(dirPath, entry);
    if (extname(entry) !== ".md") continue;

    let isFile: boolean;
    try {
      isFile = statSync(entryPath).isFile();
    } catch {
      continue;
    }
    if (!isFile) continue;

    const fileBase = basename(entry, ".md");

    // 如果存在同名的目录型 Skill，单文件被覆盖
    // 注意：目录型 Skill 的目录名可能与 .md 文件名不同（若 frontmatter 指定了 name）
    // 这里需检查：若此 .md 文件解析后的 name 与任何目录型 Skill 的 name 冲突，跳过
    const skill = parseSkillFile(entryPath, source);
    if (!skill) {
      diagnostics.push({
        filePath: entryPath,
        level: "warning",
        message: `Skill 文件 "${entry}" 解析失败（frontmatter 格式错误或缺少必填字段）`,
      });
      continue;
    }

    const name = skill.frontmatter.name || fileBase;

    // 目录型优先：如果目录型 Skill 已经用此 name，跳过单文件
    if (seenNames.has(name)) {
      diagnostics.push({
        filePath: entryPath,
        level: "warning",
        message: `单文件 Skill "${entry}" 被同名目录型 Skill 覆盖，已跳过`,
      });
      continue;
    }

    skills.push(skill);
    seenNames.add(name);
  }

  return { skills, diagnostics };
}

// scanAll —— 扫描三层，按优先级去重覆盖
export function scanAll(projectRoot: string): { skills: Skill[]; diagnostics: SkillDiagnostic[] } {
  const dirs = getDirs(projectRoot);
  const layers: { dir: string; source: SkillSource }[] = [
    { dir: dirs.builtin, source: "builtin" },
    { dir: dirs.user, source: "user" },
    { dir: dirs.project, source: "project" },
  ];

  const skillMap = new Map<string, Skill>();
  const allDiagnostics: SkillDiagnostic[] = [];

  for (const layer of layers) {
    const { skills, diagnostics } = scanDir(layer.dir, layer.source);
    allDiagnostics.push(...diagnostics);

    for (const skill of skills) {
      const name = skill.frontmatter.name;
      skillMap.set(name, skill); // 后扫的覆盖先扫的
    }
  }

  return {
    skills: Array.from(skillMap.values()),
    diagnostics: allDiagnostics,
  };
}

// loadOne —— 按名加载单个 Skill（用于热更新）
export function loadOne(name: string, projectRoot: string): Skill | null {
  const { skills } = scanAll(projectRoot);
  return skills.find((s) => s.frontmatter.name === name) ?? null;
}

// toSummaries —— 将 Skill 列表转为 SkillSummary 列表
export function toSummaries(skills: Skill[]): SkillSummary[] {
  return skills.map((s) => ({
    name: s.frontmatter.name,
    description: s.frontmatter.description,
    source: s.source,
    aliases: s.frontmatter.aliases,
  }));
}
