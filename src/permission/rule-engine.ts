import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { minimatch } from "minimatch";
import type { PermissionRequest, PermissionResult, Rule } from "./types.js";

// 工具名 → 规则中使用的短名称映射
const TOOL_SHORT_NAME: Record<string, string> = {
  run_command: "Bash",
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  glob: "Glob",
  grep: "Grep",
};

// 规则行正则：工具名(模式): 动作  或  工具名: 动作
const RULE_REGEX = /^(\w+)(?:\(([^)]*)\))?:\s*(allow|deny)$/;

// parseRuleLine —— 解析单行规则字符串
function parseRuleLine(line: string, source: string): Rule | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const match = trimmed.match(RULE_REGEX);
  if (!match) return null;

  const [, toolPattern, paramPattern, action] = match;
  return {
    toolPattern,
    paramPattern: paramPattern ?? "*", // 无括号时匹配所有
    action: action as "allow" | "deny",
    source,
  };
}

// loadRulesFromFile —— 从 YAML 文件加载规则列表
function loadRulesFromFile(filePath: string): Rule[] {
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

  const rulesArr = parsed.rules;
  if (!Array.isArray(rulesArr)) return [];

  const rules: Rule[] = [];
  for (const entry of rulesArr) {
    if (typeof entry !== "string") continue;
    const rule = parseRuleLine(entry, filePath);
    if (rule) rules.push(rule);
  }
  return rules;
}

// buildShortName —— 获取工具的短名称
function buildShortName(toolName: string): string {
  return TOOL_SHORT_NAME[toolName] ?? toolName;
}

// extractParamSummary —— 从 params 中提取参数摘要用于规则匹配
function extractParamSummary(toolName: string, params: Record<string, unknown>): string {
  switch (toolName) {
    case "run_command":
      return typeof params.command === "string" ? params.command : "";
    case "read_file":
    case "write_file":
    case "edit_file":
    case "glob":
    case "grep": {
      const pathKeys = ["filePath", "path", "pattern"];
      for (const key of pathKeys) {
        if (typeof params[key] === "string") return params[key] as string;
      }
      return "";
    }
    default:
      // 通用提取：第一个 string 值
      for (const value of Object.values(params)) {
        if (typeof value === "string") return value;
      }
      return "";
  }
}

// buildMatchString —— 构造用于规则匹配的字符串
function buildMatchString(toolName: string, params: Record<string, unknown>): string {
  const shortName = buildShortName(toolName);
  const paramSummary = extractParamSummary(toolName, params);
  if (paramSummary) {
    return `${shortName}(${paramSummary})`;
  }
  return shortName;
}

// buildRulePattern —— 构造规则的完整 glob 模式
function buildRulePattern(rule: Rule): string {
  if (rule.paramPattern === "*" || rule.paramPattern === "") {
    return `${rule.toolPattern}(*)`;
  }
  return `${rule.toolPattern}(${rule.paramPattern})`;
}

// RuleEngine —— Layer 3 规则引擎
export class RuleEngine {
  private globalRules: Rule[] = [];
  private projectRules: Rule[] = [];
  private localRules: Rule[] = [];
  private sessionRules: Rule[] = []; // 会话级临时规则（内存中）

  private globalPath: string | undefined;
  private projectPath: string | undefined;
  private localPath: string | undefined;

  constructor(globalPath?: string, projectPath?: string, localPath?: string) {
    this.globalPath = globalPath;
    this.projectPath = projectPath;
    this.localPath = localPath;
  }

  // load —— 加载三层 YAML 规则文件
  async load(): Promise<void> {
    if (this.globalPath) {
      this.globalRules = loadRulesFromFile(this.globalPath);
    }
    if (this.projectPath) {
      this.projectRules = loadRulesFromFile(this.projectPath);
    }
    if (this.localPath) {
      this.localRules = loadRulesFromFile(this.localPath);
    }
  }

  // getAllLayers —— 按优先级顺序返回所有规则层（本地 > 项目 > 全局 > 会话）
  private getAllLayers(): Array<{ rules: Rule[]; source: string }> {
    return [
      { rules: this.sessionRules, source: "session" },
      { rules: this.localRules, source: "local" },
      { rules: this.projectRules, source: "project" },
      { rules: this.globalRules, source: "global" },
    ];
  }

  // matchRule —— 判断规则是否匹配
  private matchRule(rule: Rule, matchString: string): boolean {
    const rulePattern = buildRulePattern(rule);
    return minimatch(matchString, rulePattern, { dot: true });
  }

  // check —— 检查是否有规则命中
  check(request: PermissionRequest): PermissionResult | null {
    const matchString = buildMatchString(request.toolName, request.params);

    // 先遍历所有层找 deny（deny-anywhere 否决）
    for (const layer of this.getAllLayers()) {
      for (const rule of layer.rules) {
        if (rule.action === "deny" && this.matchRule(rule, matchString)) {
          return {
            decision: "deny",
            layer: 3,
            reason: `规则引擎：匹配 deny 规则 "${rule.toolPattern}(${rule.paramPattern}): deny"（来源: ${rule.source}）`,
            ruleSource: rule.source,
          };
        }
      }
    }

    // 无 deny，找 allow
    for (const layer of this.getAllLayers()) {
      for (const rule of layer.rules) {
        if (rule.action === "allow" && this.matchRule(rule, matchString)) {
          return {
            decision: "allow",
            layer: 3,
            reason: `规则引擎：匹配 allow 规则 "${rule.toolPattern}(${rule.paramPattern}): allow"（来源: ${rule.source}）`,
            ruleSource: rule.source,
          };
        }
      }
    }

    return null;
  }

  // addRule —— 添加会话级临时规则（不持久化）
  addRule(rule: Rule): void {
    this.sessionRules.push(rule);
  }

  // persistRule —— 将规则持久化写入 permissions.local.yaml
  async persistRule(rule: Rule): Promise<void> {
    if (!this.localPath) {
      throw new Error("无法持久化规则：未指定本地配置文件路径");
    }

    // 添加为会话规则
    this.addRule(rule);

    // 写入 YAML 文件
    let existingRules: Rule[] = [];
    if (existsSync(this.localPath)) {
      existingRules = loadRulesFromFile(this.localPath);
    }

    // 去重：已有相同规则则跳过
    const alreadyExists = existingRules.some(
      (r) =>
        r.toolPattern === rule.toolPattern &&
        r.paramPattern === rule.paramPattern &&
        r.action === rule.action,
    );

    if (alreadyExists) return;

    existingRules.push(rule);

    // 序列化为 YAML
    const yamlLines = ["rules:"];
    for (const r of existingRules) {
      const patternStr = r.paramPattern && r.paramPattern !== "*" ? `${r.toolPattern}(${r.paramPattern})` : r.toolPattern;
      yamlLines.push(`  - "${patternStr}: ${r.action}"`);
    }

    // 确保目录存在
    mkdirSync(dirname(this.localPath), { recursive: true });
    writeFileSync(this.localPath, yamlLines.join("\n") + "\n", "utf-8");

    // 重载本地规则
    this.localRules = loadRulesFromFile(this.localPath);
  }
}
