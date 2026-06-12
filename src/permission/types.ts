// 权限系统的核心类型定义

// PermissionRequest —— 权限检查的输入
export interface PermissionRequest {
  toolName: string; // 工具名，如 "run_command"、"read_file"
  toolType: "file" | "shell" | "search"; // 工具类型分类
  destructive: boolean; // 是否有副作用
  params: Record<string, unknown>; // 工具调用参数
  cwd: string; // 项目根目录（绝对路径，已解析符号链接）
}

// PermissionResult —— 权限检查的输出
export interface PermissionResult {
  decision: "allow" | "deny";
  layer: 1 | 2 | 3 | 4 | 5; // 哪一层做出的决策
  reason: string; // 决策原因，例如"黑名单命中: rm -rf /"
  ruleSource?: string; // 仅 Layer 3/5 有值，命中的规则来源
}

// Rule —— 单条规则
export interface Rule {
  toolPattern: string; // 工具名 glob 模式，如 "Bash"
  paramPattern: string; // 参数/路径 glob 模式，如 "git *"，空字符串匹配所有
  action: "allow" | "deny";
  source: string; // 来源（文件路径或 "session"）
}

// PermissionMode —— 四档权限模式
export type PermissionMode =
  | "default" // 只读放行，编辑+Bash 需确认
  | "acceptsEdit" // 只读+编辑放行，Bash 需确认
  | "plan" // 只读放行，编辑+Bash 拒绝
  | "bypassPermissions"; // 仅黑名单拦截，其余放行

// ToolCategory —— 用于权限模式映射的工具分类
export type ToolCategory = "readonly" | "edit" | "shell";

// HumanChoice —— 用户在回路中的选择
export type HumanChoice = "yes" | "no" | "always_allow";

// HumanPrompt —— 向用户展示的确认信息
export interface HumanPrompt {
  toolName: string;
  toolCall: string; // 可读摘要，如 "Bash(git status)"
  reason: string; // 为什么需要确认
}

// HumanInTheLoopCallback —— TUI 层实现的回调
export type HumanInTheLoopCallback = (prompt: HumanPrompt) => Promise<HumanChoice>;
