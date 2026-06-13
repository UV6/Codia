#!/usr/bin/env tsx

import { parseArgs } from "node:util";
import { basename } from "node:path";
import { render } from "ink";
import { loadAppConfig, ConfigError } from "../src/config/index.js";
import { ChatService } from "../src/chat/chat-service.js";
import { listSessions, sessionPath, newSessionPath } from "../src/chat/history.js";
import { App } from "../src/tui/app.js";
import type { PermissionMode } from "../src/permission/types.js";

const usage = `
codia — 终端 AI 编程助手

用法: codia [选项]

选项:
  --session, -s <id>     继续指定的会话
  --sessions, -ls         列出所有历史会话
  --bypassPermissions     启动时进入 bypassPermissions 模式（跳过权限确认，仅保留黑名单）
  --help, -h              显示帮助信息

运行时命令:
  /default        切换为 default 权限模式
  /acceptsEdit    切换为 acceptsEdit 权限模式
  /plan <需求>    进入 plan 模式（自动切换为 plan 权限模式）
  /do             退出 plan 模式
`.trim();

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      session: { type: "string", short: "s" },
      sessions: { type: "boolean", short: "l" },
      bypassPermissions: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: false,
  });

  // --help
  if (values.help) {
    console.log(usage);
    process.exit(0);
  }

  // --sessions: 列出历史会话
  if (values.sessions) {
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log("暂无历史会话。");
    } else {
      console.log("历史会话：\n");
      for (const s of sessions) {
        const date = new Date(s.lastMessageTime).toLocaleString("zh-CN");
        console.log(`  ${s.id}`);
        console.log(`    消息数: ${s.messageCount}  最后活动: ${date}`);
        if (s.preview) {
          console.log(`    预览: ${s.preview}...`);
        }
        console.log();
      }
      console.log(`共 ${sessions.length} 个会话。`);
      console.log(`\n继续会话：codia --session <id>`);
    }
    process.exit(0);
  }

  // 权限模式：只有 --bypassPermissions 才能启动 bypass 模式
  const permissionMode: PermissionMode = values.bypassPermissions
    ? "bypassPermissions"
    : "default";

  // 加载配置
  let appConfig;
  try {
    appConfig = loadAppConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`配置错误 [${e.code}]：${e.message}`);
    } else {
      console.error("启动失败：", (e as Error).message);
    }
    process.exit(1);
  }

  // 确定会话文件
  const sessionId = typeof values.session === "string" ? values.session : undefined;
  const filePath = sessionId
    ? sessionPath(sessionId)
    : newSessionPath();

  if (sessionId) {
    console.log(`继续会话：${sessionId}`);
  } else {
    const id = basename(filePath, ".jsonl");
    console.log(`新会话：${id}`);
  }

  const service = new ChatService(
    appConfig,
    filePath,
    appConfig.agentLoop.maxRounds,
    permissionMode,
  );

  process.on("exit", () => {
    service.cancel();
  });

  const { waitUntilExit } = render(<App service={service} />, {
    exitOnCtrlC: true,
  });

  await waitUntilExit();
}

main();
