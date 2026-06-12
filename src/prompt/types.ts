// Section —— System Prompt 中的一个模块
export interface Section {
  name: string;       // 模块名（"身份"、"工具使用" 等）
  priority: number;   // 优先级，小的排前面
  content: string;    // 模块文本内容
}

// SystemReminder —— 运行时动态注入的系统提醒
export interface SystemReminder {
  source: string;     // 来源标识（"plan-mode"、"env-info"、"mcp"）
  content: string;    // 纯文本（不含 <system-reminder> 标签本身）
  round: number;      // 注入时的轮次
}

// ReminderProvider —— 根据轮次返回应注入的提醒列表
export type ReminderProvider = (round: number) => SystemReminder[];
