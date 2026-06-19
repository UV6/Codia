import { exec } from "node:child_process";
import type { HookAction, HookContext, ResolvedControl } from "./types.js";
import { getFieldValue } from "./matcher.js";

// substituteTemplate —— 模板替换：将 "{{field.path}}" 替换为 context 中的值
export function substituteTemplate(template: string, context: HookContext): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, fieldPath: string) => {
    const value = getFieldValue(context, fieldPath.trim());
    return value ?? "";
  });
}

// executeCommand —— 执行 shell 命令
function executeCommand(
  command: string,
  context: HookContext,
  timeout: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const cmd = substituteTemplate(command, context);

    const child = exec(
      cmd,
      {
        timeout,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          console.warn(`[Hook] 命令执行失败: ${cmd}`, error.message);
          // 即使有错误，也返回可用的输出
          const output = [stdout, stderr].filter(Boolean).join("\n").trim();
          resolve(output || null);
          return;
        }
        resolve(stdout.trim());
      },
    );

    // 超时处理
    child.on("error", (err) => {
      console.warn(`[Hook] 命令启动失败: ${cmd}`, err.message);
      resolve(null);
    });
  });
}

// executePrompt —— 返回替换后的提示词文本
async function executePrompt(
  text: string,
  context: HookContext,
): Promise<string> {
  return substituteTemplate(text, context);
}

// executeHttp —— 发送 HTTP 请求
async function executeHttp(
  action: { url: string; method?: string; headers?: Record<string, string>; body?: string },
  context: HookContext,
  timeout: number,
): Promise<string | null> {
  try {
    const url = substituteTemplate(action.url, context);
    const method = action.method ?? "POST";

    // 替换 headers 中的模板变量
    const headers: Record<string, string> = {};
    if (action.headers) {
      for (const [key, value] of Object.entries(action.headers)) {
        headers[key] = substituteTemplate(value, context);
      }
    }

    // 若提供了 body 且未设置 Content-Type，默认 application/json
    const body = action.body ? substituteTemplate(action.body, context) : undefined;
    if (body && !("Content-Type" in headers) && !("content-type" in headers)) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeout),
    });

    const text = await response.text();
    return text;
  } catch (err) {
    console.warn(`[Hook] HTTP 请求失败: ${action.url}`, (err as Error).message);
    return null;
  }
}

// executeSubagent —— 占位实现
async function executeSubagent(
  _action: { prompt: string },
  _context: HookContext,
): Promise<null> {
  console.warn("[Hook] subagent action not implemented");
  return null;
}

// executeAction —— 执行单个动作，返回输出文本或 null
export async function executeAction(
  action: HookAction,
  context: HookContext,
  control: ResolvedControl,
): Promise<string | null> {
  try {
    switch (action.type) {
      case "command":
        return await executeCommand(action.command, context, control.timeout);
      case "prompt":
        return await executePrompt(action.text, context);
      case "http":
        return await executeHttp(
          { url: action.url, method: action.method, headers: action.headers, body: action.body },
          context,
          control.timeout,
        );
      case "subagent":
        return await executeSubagent(action, context);
      default:
        return null;
    }
  } catch (err) {
    console.warn(`[Hook] 动作执行异常: ${action.type}`, (err as Error).message);
    return null;
  }
}
