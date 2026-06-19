import type {
  HookRule,
  HookEvent,
  HookContext,
  HookInterceptResult,
  HookFireOptions,
} from "./types.js";
import { matchCondition } from "./matcher.js";
import { executeAction } from "./executor.js";

// HookEngine —— Hook 调度中枢
export class HookEngine {
  private rules: HookRule[];
  private runOnceFired: Set<string> = new Set();

  constructor(rules: HookRule[] = []) {
    this.rules = rules;
  }

  // loadRules —— 替换规则列表，清空 run_once 执行集合
  loadRules(rules: HookRule[]): void {
    this.rules = rules;
    this.runOnceFired.clear();
  }

  // getRules —— 返回当前规则列表的只读副本
  getRules(): readonly HookRule[] {
    return this.rules;
  }

  // applyControl —— 检查 run_once 控制，返回是否应执行
  private applyControl(rule: HookRule, index: number): boolean {
    if (!rule.control.run_once) return true;
    const key = `${rule.source}:${index}`;
    if (this.runOnceFired.has(key)) return false;
    this.runOnceFired.add(key);
    return true;
  }

  // fire —— 触发普通事件
  async fire(
    event: HookEvent,
    context: HookContext,
    opts?: HookFireOptions,
  ): Promise<void> {
    try {
      for (let i = 0; i < this.rules.length; i++) {
        const rule = this.rules[i];
        if (rule.event !== event) continue;

        // 条件匹配
        if (!matchCondition(rule.condition, context)) continue;

        // run_once 控制
        if (!this.applyControl(rule, i)) continue;

        if (rule.control.background) {
          // 后台异步执行，不等待
          executeAction(rule.action, context, rule.control).catch((err) => {
            console.warn(`[Hook] 后台动作异常: ${rule.event}`, err);
          });
        } else {
          const result = await executeAction(rule.action, context, rule.control);
          // prompt 动作：通过 onPrompt 回调传递文本
          if (rule.action.type === "prompt" && opts?.onPrompt && typeof result === "string") {
            try {
              opts.onPrompt(result);
            } catch {
              // 回调异常不中断
            }
          }
        }
      }
    } catch {
      // 顶层兜底：任何未预期的异常都不中断主流程
    }
  }

  // fireIntercept —— 触发拦截事件
  async fireIntercept(
    event: HookEvent,
    context: HookContext,
  ): Promise<HookInterceptResult> {
    try {
      for (let i = 0; i < this.rules.length; i++) {
        const rule = this.rules[i];
        if (rule.event !== event) continue;

        // 条件匹配
        if (!matchCondition(rule.condition, context)) continue;

        // run_once 控制
        if (!this.applyControl(rule, i)) continue;

        // 拦截事件必须同步等待
        const result = await executeAction(rule.action, context, rule.control);

        // 检查 REJECT 信号
        if (result !== null && result.startsWith("REJECT:")) {
          const reason = result.slice(7).trim() || "操作被 Hook 规则拒绝";
          return { blocked: true, reason };
        }

        // 执行失败（null）→ 宽容策略，继续下一条
      }
    } catch {
      // 异常不中断主流程，返回放行
    }

    return { blocked: false };
  }
}
