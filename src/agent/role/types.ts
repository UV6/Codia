// AgentRoleFrontmatter —— 角色 Markdown 文件 YAML frontmatter 解析结果
export interface AgentRoleFrontmatter {
  name: string; // 唯一标识，小写字母+连字符
  description: string; // 一句话用途说明
  model?: "inherit" | "haiku" | "sonnet" | "opus"; // 默认 "inherit"
  maxRounds?: number; // 最大轮次，默认 20
  permissionMode?: "default" | "acceptsEdit" | "plan" | "bypassPermissions"; // 默认 "bypassPermissions"
  tools?: string[]; // 白名单，缺省不限
  disallowedTools?: string[]; // 黑名单，在白名单基础上再剔除
}

// AgentRole —— 加载后的完整角色对象，body 伴随子 Agent 整个生命周期
export interface AgentRole {
  source: "builtin" | "plugin" | "user" | "project";
  frontmatter: AgentRoleFrontmatter;
  body: string; // Markdown 正文，子 Agent 的系统提示
  filePath?: string; // 来源文件路径（内置角色无）
}
