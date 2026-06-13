import type {
  PermissionRequest,
  PermissionResult,
  PermissionMode,
  HumanInTheLoopCallback,
} from "./types.js";
import { check as blocklistCheck } from "./blocklist.js";
import { check as sandboxCheck } from "./path-sandbox.js";
import type { RuleEngine } from "./rule-engine.js";
import { evaluate as modeEvaluate } from "./mode-evaluator.js";

// PermissionChecker —— 五层决策链编排器
export class PermissionChecker {
  private ruleEngine: RuleEngine;
  private mode: PermissionMode;
  private humanCallback: HumanInTheLoopCallback;

  constructor(
    ruleEngine: RuleEngine,
    mode: PermissionMode,
    humanCallback: HumanInTheLoopCallback,
  ) {
    this.ruleEngine = ruleEngine;
    this.mode = mode;
    this.humanCallback = humanCallback;
  }

  // setMode —— 运行时切换权限模式
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  // check —— 执行五层决策链
  async check(request: PermissionRequest): Promise<PermissionResult> {
    // Layer 1: 危险命令黑名单（仅 shell 工具）
    if (request.toolType === "shell") {
      const command = request.params.command;
      const blockResult = blocklistCheck(command);
      if (blockResult) return blockResult;
    }

    // Layer 2: 路径沙箱（仅 file 工具）
    if (request.toolType === "file") {
      const sandboxResult = sandboxCheck(request);
      if (sandboxResult) return sandboxResult;
    }

    // Layer 3: 规则引擎
    const ruleResult = this.ruleEngine.check(request);
    if (ruleResult) return ruleResult;

    // Layer 4: 权限模式默认行为
    const modeResult = modeEvaluate(
      this.mode,
      request.toolType,
      request.destructive,
    );

    if (modeResult === "allow") {
      return {
        decision: "allow",
        layer: 4,
        reason: `权限模式 "${this.mode}" 默认放行 ${request.toolName}`,
      };
    }

    if (modeResult === "deny") {
      return {
        decision: "deny",
        layer: 4,
        reason: `权限模式 "${this.mode}" 默认拒绝 ${request.toolName}`,
      };
    }

    // Layer 5: 人在回路（modeResult === "ask"）
    const choice = await this.humanCallback({
      toolName: request.toolName,
      toolCall: buildToolCallSummary(request),
      reason: `权限模式 "${this.mode}" 要求确认 ${request.toolName} 操作`,
    });

    if (choice === "no") {
      return {
        decision: "deny",
        layer: 5,
        reason: `用户拒绝了 ${request.toolName} 操作`,
      };
    }

    if (choice === "always_allow") {
      // 持久化 allow 规则：匹配该工具的所有调用（不区分参数）
      const shortName = getShortName(request.toolName);
      await this.ruleEngine.persistRule({
        toolPattern: shortName,
        paramPattern: "*",
        action: "allow",
        source: "local",
      });
      return {
        decision: "allow",
        layer: 5,
        reason: `用户选择始终允许 ${request.toolName}`,
        ruleSource: "permissions.local.yaml",
      };
    }

    // choice === "yes"
    return {
      decision: "allow",
      layer: 5,
      reason: `用户本次允许 ${request.toolName}`,
    };
  }
}

// getShortName —— 工具名到短名的映射
function getShortName(toolName: string): string {
  const map: Record<string, string> = {
    run_command: "Bash",
    read_file: "Read",
    write_file: "Write",
    edit_file: "Edit",
    glob: "Glob",
    grep: "Grep",
  };
  return map[toolName] ?? toolName;
}

// extractParamSummary —— 提取参数摘要
function extractParamSummary(
  toolName: string,
  params: Record<string, unknown>,
): string {
  switch (toolName) {
    case "run_command":
      return typeof params.command === "string" ? (params.command as string) : "";
    case "read_file":
    case "write_file":
    case "edit_file":
      return typeof params.filePath === "string" ? (params.filePath as string) : "";
    case "glob":
      return typeof params.pattern === "string" ? (params.pattern as string) : "";
    case "grep":
      return typeof params.pattern === "string" ? (params.pattern as string) : "";
    default:
      return "";
  }
}

// buildToolCallSummary —— 构造可读的工具调用摘要
function buildToolCallSummary(request: PermissionRequest): string {
  const shortName = getShortName(request.toolName);
  const paramSummary = extractParamSummary(request.toolName, request.params);
  if (paramSummary) {
    return `${shortName}(${paramSummary})`;
  }
  return shortName;
}
