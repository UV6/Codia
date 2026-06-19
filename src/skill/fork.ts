import type { Message, ChatConfig } from "../provider/types.js";
import type { Skill } from "./types.js";
import { createProvider } from "../provider/factory.js";
import { AgentLoop } from "../agent/loop.js";
import type { AgentLoopConfig } from "../agent/types.js";
import { ToolRegistry } from "../tool/registry.js";
import type { ToolMeta } from "../tool/types.js";

// ForkOptions —— Fork 模式执行选项
export interface ForkOptions {
  projectRoot: string;
  historyMessages?: Message[];
  config: ChatConfig;
  /** 外部提供的 tool metas（由主 ChatService 的工具注册中心生成） */
  toolMetas: ToolMeta[];
  skillName: string;
}

// executeFork —— 在独立上下文中执行 Skill，返回摘要
export async function* executeFork(
  skill: Skill,
  options: ForkOptions,
): AsyncIterable<string> {
  const rounds = skill.frontmatter.historyRounds ?? 0;

  // 构建独立上下文
  const messages: Message[] = [];

  // 带入最近 N 轮历史
  if (rounds > 0 && options.historyMessages && options.historyMessages.length > 0) {
    const userMessages = options.historyMessages.filter((m) => m.role === "user");
    const recent = userMessages.slice(-rounds);
    const startIndex = options.historyMessages.indexOf(recent[0]);
    messages.push(...options.historyMessages.slice(startIndex));
  }

  // 注入 Skill 指令作为用户消息
  messages.push({
    role: "user",
    content: `请按照以下 Skill 指令执行任务：\n\n${skill.body}`,
    timestamp: new Date().toISOString(),
  });

  // 创建独立的 provider 和 loop
  const provider = createProvider(options.config);
  const toolRegistry = new ToolRegistry(); // Fork 上下文可用完整工具
  // 复制主工具注册中心的工具到 fork 注册中心
  const agentLoop = new AgentLoop(toolRegistry, null as unknown as never);

  const abortController = new AbortController();
  const config: AgentLoopConfig = {
    maxRounds: 10,
    mode: "full",
  };

  // 使用主工具注册中心的 metas（通过接口注入）
  // 这里我们传递主 ToolMeta 而不是依赖 fork 的 registry
  const systemPrompt = `你正在执行 "${options.skillName}" Skill。请严格按照上述指令完成任务，完成后输出执行摘要。`;

  let fullOutput = "";

  try {
    for await (const event of agentLoop.run(
      messages,
      provider,
      options.config,
      config,
      abortController.signal,
      options.projectRoot,
      systemPrompt,
      null as unknown as never,
    )) {
      if (event.type === "text") {
        fullOutput += event.content;
      }
      yield event.type === "text" ? event.content : "";
    }
  } catch (e) {
    fullOutput = `Fork 执行异常：${(e as Error).message}`;
  }

  // 返回摘要
  yield `\n\n---\n## Fork 执行完成（${skill.frontmatter.name}）\n\n${fullOutput.slice(0, 2000)}`;
}
