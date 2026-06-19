import { minimatch } from "minimatch";
import type { FieldCondition, HookCondition, HookContext } from "./types.js";

// getFieldValue —— 从 context 中按点分隔路径取值
export function getFieldValue(context: HookContext, fieldPath: string): string | undefined {
  const parts = fieldPath.split(".");
  let current: unknown = context;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current === "string") return current;
  if (typeof current === "number") return String(current);
  if (typeof current === "boolean") return String(current);
  return undefined;
}

// matchField —— 判断单字段条件是否匹配
export function matchField(fc: FieldCondition, context: HookContext): boolean {
  const value = getFieldValue(context, fc.field);

  // 字段值不存在时视为不满足
  if (value === undefined) return false;

  // 收集此字段上所有指定的匹配模式（至少有一个由 loader 校验保证）
  const checks: boolean[] = [];

  if (fc.equals !== undefined) {
    checks.push(value === fc.equals);
  }
  if (fc.not !== undefined) {
    checks.push(value !== fc.not);
  }
  if (fc.regex !== undefined) {
    try {
      checks.push(new RegExp(fc.regex).test(value));
    } catch {
      // 无效正则视为不匹配
      checks.push(false);
    }
  }
  if (fc.glob !== undefined) {
    checks.push(minimatch(value, fc.glob, { dot: true }));
  }

  // 所有指定的模式都满足才为 true（AND）
  return checks.length > 0 && checks.every(Boolean);
}

// matchCondition —— 判断条件是否匹配事件上下文
export function matchCondition(
  condition: HookCondition | undefined,
  context: HookContext,
): boolean {
  // 无条件触发
  if (!condition) return true;
  if (condition.fields.length === 0) return true;

  if (condition.match === "all") {
    return condition.fields.every((fc) => matchField(fc, context));
  }

  // match === "any"
  return condition.fields.some((fc) => matchField(fc, context));
}
