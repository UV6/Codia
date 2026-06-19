// Hook 系统统一导出
export type {
  HookEvent,
  HookRule,
  HookCondition,
  FieldCondition,
  HookAction,
  CommandAction,
  PromptAction,
  HttpAction,
  SubagentAction,
  HookControl,
  ResolvedControl,
  HookContext,
  HookInterceptResult,
  HookFireOptions,
} from "./types.js";
export { INTERCEPT_EVENTS, DEFAULT_CONTROL } from "./types.js";

export { matchCondition, matchField, getFieldValue } from "./matcher.js";
export { loadHooksFromFile, loadAllHooks, validateRule } from "./loader.js";
export { executeAction, substituteTemplate } from "./executor.js";
export { HookEngine } from "./engine.js";
