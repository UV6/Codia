import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import type { ChatConfig } from "../provider/types.js";

// ConfigError —— 配置加载/校验失败时抛出的错误
export class ConfigError extends Error {
  code: "not_found" | "invalid_format" | "missing_field";

  constructor(code: "not_found" | "invalid_format" | "missing_field", message: string) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
  }
}

// AgentLoopConfig —— agent_loop 配置段
export interface AgentLoopYamlConfig {
  maxRounds?: number; // 默认 20
}

// MemoryConfig —— memory 配置段
export interface MemoryConfig {
  model?: string;    // 记忆提取专用模型，不配则用主模型
  enabled?: boolean; // 是否启用自动记忆，默认 true
}

// AppConfig —— 完整应用配置
export interface AppConfig extends ChatConfig {
  agentLoop: AgentLoopYamlConfig;
  memory: MemoryConfig;
  mcp?: { servers: Record<string, Record<string, unknown>> }; // mcp_servers 段原始值，不做展开（展开在 mcp/config.ts 中）
  coordinator?: { enabled: boolean }; // Coordinator 模式能力开关
}

const REQUIRED_FIELDS = ["protocol", "model", "base_url", "api_key"] as const;
const VALID_PROTOCOLS = ["anthropic", "openai"] as const;

// 默认配置文件路径：~/.Codia/Codia.yml
export const DEFAULT_CONFIG_PATH = join(homedir(), ".Codia", "Codia.yml");

// loadConfig —— 从 YAML 文件加载并校验配置
// 默认读取 ~/.Codia/Codia.yml
export function loadConfig(path: string = DEFAULT_CONFIG_PATH): ChatConfig {
  // 1. 读文件
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new ConfigError("not_found", `未找到 ${path}，请先创建配置文件`);
  }

  // 2. 解析 YAML
  let parsed: Record<string, unknown>;
  try {
    parsed = parse(raw);
  } catch (e) {
    throw new ConfigError("invalid_format", `配置文件格式错误：${(e as Error).message}`);
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new ConfigError("invalid_format", "配置文件内容不能为空");
  }

  // 3. 校验必填字段
  for (const field of REQUIRED_FIELDS) {
    if (!(field in parsed) || parsed[field] === undefined || parsed[field] === "") {
      throw new ConfigError("missing_field", `缺少必填字段：${field}`);
    }
  }

  // 4. 校验 protocol
  const protocol = parsed.protocol as string;
  if (!(VALID_PROTOCOLS as readonly string[]).includes(protocol)) {
    throw new ConfigError(
      "invalid_format",
      `protocol 字段值无效：${protocol}，支持：${VALID_PROTOCOLS.join(", ")}`,
    );
  }

  return {
    protocol: protocol as "anthropic" | "openai",
    model: parsed.model as string,
    baseUrl: (parsed.base_url as string).replace(/\/+$/, ""), // 去掉末尾斜杠
    apiKey: parsed.api_key as string,
  };
}

// loadAppConfig —— 加载包含 agent_loop 的完整配置
export function loadAppConfig(path: string = DEFAULT_CONFIG_PATH): AppConfig {
  const chatConfig = loadConfig(path);

  // 解析 agent_loop 部分
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return { ...chatConfig, agentLoop: {}, memory: {} };
  }

  const parsed = parse(raw) as Record<string, unknown>;
  const agentLoop = (parsed.agent_loop as Record<string, unknown>) ?? {};

  // 解析 mcp_servers 段（原始值，展开和合并在 mcp/config.ts 中处理）
  const mcpServers = parsed.mcp_servers as Record<string, Record<string, unknown>> | undefined;

  // 解析 memory 段
  const memoryRaw = (parsed.memory as Record<string, unknown>) ?? {};
  const memory: MemoryConfig = {};
  if (typeof memoryRaw.model === "string") {
    memory.model = memoryRaw.model;
  }
  if (typeof memoryRaw.enabled === "boolean") {
    memory.enabled = memoryRaw.enabled;
  }

  return {
    ...chatConfig,
    agentLoop: {
      maxRounds: typeof agentLoop.max_rounds === "number" ? agentLoop.max_rounds : undefined,
    },
    memory,
    mcp: mcpServers ? { servers: mcpServers } : undefined,
  };
}
