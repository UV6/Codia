// 命令系统类型定义

// CommandType —— 命令的执行模式
export type CommandType = "local" | "ui" | "prompt";

// UIContext —— 命令与界面的抽象交互接口
// 命令处理函数只依赖此接口，不感知具体渲染框架
export interface UIContext {
  showMessage(text: string, type: "info" | "warning" | "error"): void;
  sendUserMessage(text: string): void; // 直接调 ChatService.sendMessage()，绕过命令分流器
  clearMessages(): void;
  setMode(mode: "full" | "plan"): void;
  getMode(): "full" | "plan";
  setPermissionMode(mode: import("../permission/types.js").PermissionMode): void;
  getTokenUsage(): { inputTokens: number; outputTokens: number; model: string } | null;
  triggerCompact(): void;
  refreshStatus(): void;
}

// CommandHandler —— 命令处理函数签名
// args: 命令名之后的参数文本（已 trim），可能为空
// ui: 界面控制接口
export type CommandHandler = (args: string, ui: UIContext) => void;

// CommandDef —— 命令定义对象
export interface CommandDef {
  name: string;            // 命令名（不含 /），小写
  aliases?: string[];      // 别名列表，不含 /
  description: string;     // 简短描述
  usage?: string;          // 用法示例
  type: CommandType;       // 执行模式
  argsHint?: string;       // 参数提示
  hidden?: boolean;        // 是否隐藏（不参与补全和 help 列表）
  promptText?: string;     // prompt 型命令的预设提示词（仅 prompt 型需要）
  handler: CommandHandler; // 处理函数（prompt 型可留空）
}

// ParseResult —— 命令解析结果
export interface ParseResult {
  isCommand: boolean;
  name: string;  // 命令名（小写），非命令时为空
  args: string;  // 参数字符串，非命令时为空
}

// CompletionResult —— Tab 补全结果
export type CompletionResult =
  | { type: "single"; completion: string }   // 单匹配，直接补全
  | { type: "multiple"; matches: string[] }  // 多匹配，弹菜单
  | { type: "none" };                        // 无匹配
