import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { HookRule, HookEvent, HookCondition, FieldCondition, HookAction } from "./types.js";
import { INTERCEPT_EVENTS, DEFAULT_CONTROL } from "./types.js";

const ALL_EVENTS: HookEvent[] = [
  "startup", "shutdown", "session_start", "session_end",
  "turn_start", "turn_end", "pre_llm", "post_llm",
  "pre_tool", "post_tool",
];

const ALL_ACTION_TYPES = ["command", "prompt", "http", "subagent"];

// isObject —— 类型守卫
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// validateRule —— 校验单条规则，返回错误信息列表（空数组表示通过）
export function validateRule(rule: unknown, source: string): string[] {
  const errors: string[] = [];

  if (!isObject(rule)) {
    errors.push("规则必须为对象");
    return errors;
  }

  // event 校验
  if (typeof rule.event !== "string" || !ALL_EVENTS.includes(rule.event as HookEvent)) {
    errors.push(`event 字段缺失或未知事件: ${String(rule.event)}`);
  }
  const event = rule.event as HookEvent;

  // if 校验
  const rawCondition = rule.if;
  if (rawCondition !== undefined && rawCondition !== null && !(isObject(rawCondition) && Object.keys(rawCondition).length === 0)) {
    if (!isObject(rawCondition)) {
      errors.push("if 字段必须为对象");
    } else {
      const cond = rawCondition as Record<string, unknown>;
      if (cond.match !== "all" && cond.match !== "any") {
        errors.push(`if.match 必须为 "all" 或 "any"，当前值: ${String(cond.match)}`);
      }
      if (!Array.isArray(cond.fields) || cond.fields.length === 0) {
        errors.push("if.fields 必须为非空数组");
      } else {
        for (let i = 0; i < (cond.fields as unknown[]).length; i++) {
          const fc = (cond.fields as unknown[])[i];
          if (!isObject(fc)) {
            errors.push(`if.fields[${i}] 必须为对象`);
            continue;
          }
          if (typeof (fc as Record<string, unknown>).field !== "string") {
            errors.push(`if.fields[${i}].field 必填`);
          }
          const hasMatchMode = (fc as Record<string, unknown>).equals !== undefined
            || (fc as Record<string, unknown>).not !== undefined
            || (fc as Record<string, unknown>).regex !== undefined
            || (fc as Record<string, unknown>).glob !== undefined;
          if (!hasMatchMode) {
            errors.push(`if.fields[${i}] 缺少匹配模式 (equals/not/regex/glob 至少选一个)`);
          }
        }
      }
    }
  }

  // action 校验
  if (!isObject(rule.action)) {
    errors.push("action 字段缺失或格式错误");
  } else {
    const action = rule.action as Record<string, unknown>;
    if (typeof action.type !== "string" || !ALL_ACTION_TYPES.includes(action.type)) {
      errors.push(`action.type 未知: ${String(action.type)}，支持: ${ALL_ACTION_TYPES.join(", ")}`);
    } else {
      const atype = action.type;
      if (atype === "command" && typeof action.command !== "string") {
        errors.push("command 动作缺少 command 字段");
      }
      if (atype === "prompt" && typeof action.text !== "string") {
        errors.push("prompt 动作缺少 text 字段");
      }
      if (atype === "http" && typeof action.url !== "string") {
        errors.push("http 动作缺少 url 字段");
      }
      if (atype === "subagent" && typeof action.prompt !== "string") {
        errors.push("subagent 动作缺少 prompt 字段");
      }
    }
  }

  // control 校验
  if (rule.control !== undefined && rule.control !== null) {
    if (!isObject(rule.control)) {
      errors.push("control 字段必须为对象");
    } else {
      const ctrl = rule.control as Record<string, unknown>;
      if (ctrl.background === true && INTERCEPT_EVENTS.includes(event)) {
        errors.push(`拦截事件 "${event}" 不允许 background: true`);
      }
      if (ctrl.timeout !== undefined && (typeof ctrl.timeout !== "number" || ctrl.timeout <= 0 || !Number.isInteger(ctrl.timeout))) {
        errors.push("control.timeout 必须为正整数");
      }
    }
  }

  return errors;
}

// normalizeCondition —— 将 if: {} 归一化为 undefined
function normalizeCondition(raw: unknown): HookCondition | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObject(raw)) return undefined;
  // if: {} → 无条件
  if (Object.keys(raw).length === 0) return undefined;
  const cond = raw as Record<string, unknown>;
  // if.fields 为空数组 → 无条件
  if (Array.isArray(cond.fields) && cond.fields.length === 0) return undefined;
  // 如果 match 或 fields 不合法，也返回 undefined（校验阶段会报错）
  if (typeof cond.match !== "string" || !Array.isArray(cond.fields)) return undefined;
  return {
    match: cond.match as "all" | "any",
    fields: cond.fields as FieldCondition[],
  };
}

// resolveControl —— 合并 control 默认值
function resolveControl(raw: unknown): { run_once: boolean; background: boolean; timeout: number } {
  const resolved = { ...DEFAULT_CONTROL };
  if (isObject(raw)) {
    const ctrl = raw as Record<string, unknown>;
    if (typeof ctrl.run_once === "boolean") resolved.run_once = ctrl.run_once;
    if (typeof ctrl.background === "boolean") resolved.background = ctrl.background;
    if (typeof ctrl.timeout === "number" && ctrl.timeout > 0) resolved.timeout = ctrl.timeout;
  }
  return resolved;
}

// loadHooksFromFile —— 从单个 YAML 文件加载 Hook 规则
export function loadHooksFromFile(filePath: string): HookRule[] {
  if (!existsSync(filePath)) return [];

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(raw) as Record<string, unknown>;
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object") return [];

  const hooksArr = parsed.hooks;
  if (!Array.isArray(hooksArr)) return [];

  const rules: HookRule[] = [];
  for (let i = 0; i < hooksArr.length; i++) {
    const entry = hooksArr[i];
    const errors = validateRule(entry, filePath);

    if (errors.length > 0) {
      console.warn(`[Hook] 跳过 ${filePath} 第 ${i + 1} 条规则，校验失败：${errors.join("; ")}`);
      continue;
    }

    const ruleObj = entry as Record<string, unknown>;
    const action = ruleObj.action as Record<string, unknown>;
    const rule: HookRule = {
      event: ruleObj.event as HookEvent,
      condition: normalizeCondition(ruleObj.if),
      action: { ...action } as unknown as HookAction,
      control: resolveControl(ruleObj.control),
      source: filePath,
    };
    rules.push(rule);
  }
  return rules;
}

// loadAllHooks —— 加载三层配置并合并
export function loadAllHooks(
  globalPath?: string,
  projectPath?: string,
  localPath?: string,
): HookRule[] {
  const all: HookRule[] = [];

  if (globalPath) {
    all.push(...loadHooksFromFile(globalPath));
  }
  if (projectPath) {
    all.push(...loadHooksFromFile(projectPath));
  }
  if (localPath) {
    all.push(...loadHooksFromFile(localPath));
  }

  return all;
}
