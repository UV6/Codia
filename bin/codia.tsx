#!/usr/bin/env tsx

import { render } from "ink";
import { loadConfig, ConfigError } from "../src/config/index.js";
import { ChatService } from "../src/chat/chat-service.js";
import { App } from "../src/tui/app.js";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`配置错误 [${e.code}]：${e.message}`);
    } else {
      console.error("启动失败：", (e as Error).message);
    }
    process.exit(1);
  }

  const service = new ChatService(config);

  // 确保退出时恢复终端
  process.on("exit", () => {
    service.cancel();
  });

  const { waitUntilExit } = render(<App service={service} />, {
    exitOnCtrlC: true,
  });

  await waitUntilExit();
}

main();
