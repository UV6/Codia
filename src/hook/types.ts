// Hook 系统的核心类型定义

// HookEvent —— 生命周期事件枚举
export type HookEvent =
  | "startup"
  | "shutdown"
  | "session_start"
  | "session_end"
  | "turn_start"
  | "turn_end"
  | "pre_llm"
  | "post_llm"
  | "pre_tool"
  | "post_tool";

// 拦截事件列表（不允许 background: true）
export const INTERCEPT_EVENTS: HookEvent[] = ["pre_tool"];

// FieldCondition —— 单字段条件
export interface FieldCondition {
  field: string; // 字段路径，如 "params.command"
  equals?: string; // 精确匹配
  not?: string; // 反向匹配
  regex?: string; // 正则匹配
  glob?: string; // glob 匹配
}

// HookCondition —— 条件表达式
export interface HookCondition {
  match: "all" | "any"; // 逻辑组合方式
  fields: FieldCondition[]; // 字段条件列表
}

// CommandAction —— Shell 命令动作
export interface CommandAction {
  type: "command";
  command: string; // 支持 {{var}} 模板
}

// PromptAction —— 提示词注入动作
export interface PromptAction {
  type: "prompt";
  text: string; // 支持 {{var}} 模板
}

// HttpAction —— HTTP 请求动作
export interface HttpAction {
  type: "http";
  url: string;
  method?: string; // 默认 "POST"
  headers?: Record<string, string>;
  body?: string; // JSON 字符串，支持 {{var}} 模板
}

// SubagentAction —— 子 Agent 动作（占位）
export interface SubagentAction {
  type: "subagent";
  prompt: string; // 支持 {{var}} 模板
}

// HookAction —— 动作联合类型
export type HookAction = CommandAction | PromptAction | HttpAction | SubagentAction;

// HookControl —— 执行控制参数
export interface HookControl {
  run_once?: boolean; // 默认 false
  background?: boolean; // 默认 false，拦截事件不可用
  timeout?: number; // 默认 30000ms
}

// ResolvedControl —— 应用默认值后的完整 control
export type ResolvedControl = Required<HookControl>;

// DEFAULT_CONTROL —— 默认控制参数
export const DEFAULT_CONTROL: ResolvedControl = {
  run_once: false,
  background: false,
  timeout: 30000,
};

// HookRule —— 一条完整的 Hook 规则
export interface HookRule {
  event: HookEvent;
  condition?: HookCondition; // 省略时无条件触发
  action: HookAction;
  control: ResolvedControl; // 加载时已应用 DEFAULT_CONTROL
  source: string; // 来源文件路径
}

// HookContext —— 事件上下文（不同事件携带不同字段）
export type HookContext = Record<string, unknown>;

// HookInterceptResult —— 拦截事件的结果
export interface HookInterceptResult {
  blocked: boolean;
  reason?: string; // 拒绝原因（blocked=true 时）
}

// HookFireOptions —— fire() 的额外选项
export interface HookFireOptions {
  onPrompt?: (text: string) => void; // prompt 动作文本的回调
}
