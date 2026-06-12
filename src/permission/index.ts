// 类型
export type {
  PermissionRequest,
  PermissionResult,
  Rule,
  PermissionMode,
  ToolCategory,
  HumanChoice,
  HumanPrompt,
  HumanInTheLoopCallback,
} from "./types.js";

// Layer 1: 危险命令黑名单
export { check as checkBlocklist } from "./blocklist.js";

// Layer 2: 路径沙箱
export { check as checkPathSandbox } from "./path-sandbox.js";

// Layer 3: 规则引擎
export { RuleEngine } from "./rule-engine.js";

// Layer 4: 权限模式评估器
export { evaluate as evaluateMode, toolTypeToCategory } from "./mode-evaluator.js";

// 五层编排器
export { PermissionChecker } from "./checker.js";
