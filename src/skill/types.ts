// Skill 系统核心类型定义

// SkillMode —— 执行模式
export type SkillMode = "inline" | "fork";

// SkillSource —— Skill 来源层级
export type SkillSource = "builtin" | "user" | "project";

// SkillFrontmatter —— YAML frontmatter 解析结果
export interface SkillFrontmatter {
  name: string; // 唯一标识，小写字母+连字符
  description: string; // 一句话说明
  mode: SkillMode; // 执行模式
  allowedTools?: string[]; // 可见工具白名单，缺省不限制
  aliases?: string[]; // 命令别名
  historyRounds?: number; // fork 模式带入的历史轮数
  model?: string; // 指定模型
}

// Skill —— 完整 Skill 对象
export interface Skill {
  source: SkillSource; // 来源层级
  dir: string; // 所在目录路径（目录型 Skill 时为子目录路径）
  frontmatter: SkillFrontmatter; // 解析后的元信息
  body: string; // Markdown 正文（SOP 指令）
}

// SkillSummary —— 阶段一摘要（仅 name + description）
export interface SkillSummary {
  name: string;
  description: string;
  source: SkillSource;
  aliases?: string[];
}

// SkillDiagnostic —— 诊断信息
export interface SkillDiagnostic {
  filePath: string; // 来源文件路径
  level: "error" | "warning"; // 严重级别
  message: string; // 具体原因
}

// SkillLoadResult —— LoadSkill 工具返回值
export interface SkillLoadResult {
  name: string; // 已加载的 Skill 名
  mode: SkillMode; // 执行模式
  body: string; // 经参数替换后的正文
  resources: string[]; // 目录型 Skill 的附属资源文件列表
}
