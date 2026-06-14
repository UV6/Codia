import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import type { McpConfig, McpServerConfig } from "./types.js";

// getUserConfigPath —— 用户级配置文件默认路径
export function getUserConfigPath(): string {
  return join(homedir(), ".Codia", "Codia.yml");
}

// getProjectConfigPath —— 项目级配置文件默认路径
export function getProjectConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, ".codia", "config.yml");
}

// loadMcpConfig —— 从用户级和项目级配置文件加载并合并 MCP Server 配置
export function loadMcpConfig(
  userConfigPath?: string,
  projectConfigPath?: string,
): McpConfig {
  const userPath = userConfigPath ?? getUserConfigPath();
  const projectPath = projectConfigPath ?? getProjectConfigPath();

  const userServers = readServersFromYaml(userPath);
  const projectServers = readServersFromYaml(projectPath);

  // 合并：项目级覆盖用户级同名 Server
  const merged: Record<string, McpServerConfig> = { ...userServers };
  for (const [name, config] of Object.entries(projectServers)) {
    merged[name] = config;
  }

  // 展开环境变量并校验
  const validated: Record<string, McpServerConfig> = {};
  for (const [name, config] of Object.entries(merged)) {
    const expanded = expandServerConfig(config);
    const errors = validateServerConfig(name, expanded);
    if (errors.length > 0) {
      console.warn(`[MCP] 跳过 Server "${name}": ${errors.join("; ")}`);
      continue;
    }
    validated[name] = expanded;
  }

  return { servers: validated };
}

// readServersFromYaml —— 从 YAML 文件读取 mcp_servers 段
function readServersFromYaml(path: string): Record<string, McpServerConfig> {
  if (!existsSync(path)) return {};

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return {};
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object") return {};

  const mcpServers = parsed.mcp_servers as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!mcpServers || typeof mcpServers !== "object") return {};

  const result: Record<string, McpServerConfig> = {};
  for (const [name, rawConfig] of Object.entries(mcpServers)) {
    if (!rawConfig || typeof rawConfig !== "object") continue;
    const config: McpServerConfig = {
      type: (rawConfig.type as "stdio" | "http") ?? "stdio",
    };
    if (config.type === "stdio") {
      if (typeof rawConfig.command === "string")
        config.command = rawConfig.command;
      if (Array.isArray(rawConfig.args))
        config.args = rawConfig.args as string[];
      if (rawConfig.env && typeof rawConfig.env === "object")
        config.env = rawConfig.env as Record<string, string>;
    } else {
      if (typeof rawConfig.url === "string") config.url = rawConfig.url;
      if (rawConfig.headers && typeof rawConfig.headers === "object")
        config.headers = rawConfig.headers as Record<string, string>;
    }
    result[name] = config;
  }

  return result;
}

// expandEnvVars —— 把字符串中的 ${VAR} 替换为 process.env[VAR] 的值
export function expandEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    return process.env[name] ?? "";
  });
}

// expandServerConfig —— 对单个 Server 配置执行环境变量展开
function expandServerConfig(config: McpServerConfig): McpServerConfig {
  const expanded: McpServerConfig = { ...config };

  if (expanded.env) {
    const expandedEnv: Record<string, string> = {};
    for (const [key, val] of Object.entries(expanded.env)) {
      expandedEnv[key] = expandEnvVars(val);
    }
    expanded.env = expandedEnv;
  }

  if (expanded.headers) {
    const expandedHeaders: Record<string, string> = {};
    for (const [key, val] of Object.entries(expanded.headers)) {
      expandedHeaders[key] = expandEnvVars(val);
    }
    expanded.headers = expandedHeaders;
  }

  // url 也支持 ${VAR} 展开
  if (expanded.url) {
    expanded.url = expandEnvVars(expanded.url);
  }

  return expanded;
}

// validateServerConfig —— 校验 Server 配置，返回错误信息数组
export function validateServerConfig(
  name: string,
  config: McpServerConfig,
): string[] {
  const errors: string[] = [];

  // Server name 不允许含下划线
  if (name.includes("_")) {
    errors.push(
      `Server 名 "${name}" 不允许包含下划线（_），避免和 serverName_toolName 格式冲突`,
    );
  }

  // type 校验
  if (config.type !== "stdio" && config.type !== "http") {
    errors.push(`不支持的 Server 类型 "${config.type}"，只支持 stdio 或 http`);
  }

  // stdio 必有 command
  if (config.type === "stdio" && !config.command) {
    errors.push('stdio 类型必须提供 "command" 字段');
  }

  // http 必有 url
  if (config.type === "http" && !config.url) {
    errors.push('http 类型必须提供 "url" 字段');
  }

  return errors;
}
