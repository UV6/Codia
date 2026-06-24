import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import { basename } from "node:path";
import { InputBox } from "./input-box.js";
import { ChatView } from "./chat-view.js";
import { ThinkingBox } from "./thinking-box.js";
import { InfoBar } from "./info-bar.js";
import { StartupBanner } from "./startup-banner.js";
import pkg from "../../package.json" with { type: "json" };
import type { Message } from "../provider/types.js";
import type { ChatService } from "../chat/chat-service.js";
import type { HumanChoice, HumanPrompt, PermissionMode } from "../permission/types.js";
import { CommandRegistry } from "../command/registry.js";
import { parseCommand } from "../command/parser.js";
import { dispatch } from "../command/dispatcher.js";
import { getBuiltinCommands } from "../command/builtin/index.js";
import { setCommandProvider } from "../command/builtin/help.js";
import { setSessionInfoProvider } from "../command/builtin/session.js";
import { setPermissionInfoProvider } from "../command/builtin/permission.js";
import type { UIContext } from "../command/types.js";

interface AppProps {
  service: ChatService;
}

// App —— Ink 根组件，管理全局状态
export function App({ service }: AppProps) {
  const [messages, setMessages] = useState<Message[]>(service.history);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [streamingThinking, setStreamingThinking] = useState<string>("");
  const [thinkingCollapsed, setThinkingCollapsed] = useState(false);
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number; model: string }>({ inputTokens: 0, outputTokens: 0, model: "" });
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [mode, setModeState] = useState<"full" | "plan">(service.currentMode);
  const [permMode, setPermMode] = useState<PermissionMode>(service.currentPermissionMode);
  const [currentRound, setCurrentRound] = useState(0);
  const [mcpCount, setMcpCount] = useState(service.mcpCount);
  const [toolCount, setToolCount] = useState(service.toolCount);

  // 权限确认状态
  const [permissionPrompt, setPermissionPrompt] = useState<HumanPrompt | null>(null);
  // 用 ref 存储 resolve 回调，避免放到 state 里
  const permissionResolveRef = useRef<((choice: HumanChoice) => void) | null>(null);

  // 工具结果展开/折叠状态
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  // 人在回路回调：设置状态 + 返回 Promise
  const humanInTheLoop = useCallback((prompt: HumanPrompt): Promise<HumanChoice> => {
    return new Promise<HumanChoice>((resolve) => {
      permissionResolveRef.current = resolve;
      setPermissionPrompt(prompt);
    });
  }, []);

  // 命令注册中心（仅首次）
  const registry = useMemo(() => {
    const reg = new CommandRegistry();
    const skillSummaries = service.getSkillRegistry().getSummaries();
    const commands = getBuiltinCommands(skillSummaries);
    for (const cmd of commands) {
      reg.register(cmd);
    }
    // 注入命令列表供 /help 使用
    setCommandProvider(() => reg.getAll());
    return reg;
  }, [service]);

  // 注入会话信息供 /session 使用
  useEffect(() => {
    setSessionInfoProvider(() => {
      const lines: string[] = [
        `会话文件: ${service.sessionPath}`,
        `消息数: ${service.history.length}`,
        `模式: ${mode === "plan" ? "PLAN" : "DEFAULT"}`,
      ];
      return lines.join("\n");
    });
  }, [service, mode]);

  // 注入权限信息供 /permission 使用
  useEffect(() => {
    setPermissionInfoProvider(() => {
      const labels: Record<string, string> = {
        bypassPermissions: "⚠ 危险模式 (bypassPermissions) — 跳过所有确认",
        plan: "📋 PLAN — 只读工具",
        acceptsEdit: "✏️ ACCEPT_EDITS — AI 可编辑文件",
        default: "⬡ DEFAULT — 正常权限检查",
      };
      return `权限模式: ${labels[permMode] ?? permMode}`;
    });
  }, [permMode]);

  // AI 对话提交（不经命令分流，供 prompt 型命令和普通对话使用）
  const handleAISubmit = useCallback(async (text: string) => {
    if (!text.trim()) return;

    setError(null);
    setStreamingContent("");
    setStreamingThinking("");
    setToolStatus(null);
    setThinkingCollapsed(false);
    setIsStreaming(true);
    setCurrentRound(0);

    // 立即把用户消息加入视图
    const userMsg: Message = {
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    let fullContent = "";
    let fullThinking = "";
    let thinkingAutoCollapsed = false;

    try {
      for await (const chunk of service.sendMessage(text)) {
        switch (chunk.type) {
          case "text":
            // 思考完成后自动折叠，腾出视野给回答
            if (fullThinking && !thinkingAutoCollapsed) {
              setThinkingCollapsed(true);
              thinkingAutoCollapsed = true;
            }
            fullContent += chunk.content;
            setStreamingContent(fullContent);
            break;
          case "thinking":
            fullThinking += chunk.content;
            setStreamingThinking(fullThinking);
            break;
          case "usage":
            setUsage((prev) => ({
              inputTokens: prev.inputTokens + chunk.usage.inputTokens,
              outputTokens: prev.outputTokens + chunk.usage.outputTokens,
              model: chunk.usage.model,
            }));
            break;
          case "tool_status":
            setToolStatus(`🔧 ${chunk.name} ${chunk.param}`);
            break;
          case "error":
            setError(chunk.error.message);
            break;
          case "tool_result":
            // 工具执行完后同步消息历史，让 ChatView 显示命令输出
            setMessages(service.history);
            break;
          case "round_start":
            setCurrentRound(chunk.round);
            break;
          case "stopped":
            // AgentLoop 停止后从 service 同步完整消息历史
            setMessages(service.history);
            setStreamingContent("");
            setStreamingThinking("");
            break;
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsStreaming(false);
    }
  }, [service]);

  // UIContext 实例 — 桥接命令系统与 App state / ChatService
  const uiContext: UIContext = useMemo(() => ({
    showMessage(text: string, type: "info" | "warning" | "error"): void {
      const rolePrefix = type === "error" ? "✗" : type === "warning" ? "⚠" : "ℹ";
      const sysMsg: Message = {
        role: "user",
        content: `${rolePrefix} ${text}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, sysMsg]);
    },

    sendUserMessage(text: string): void {
      // 直接走 AI 路径，绕过命令分流器
      handleAISubmit(text);
    },

    clearMessages(): void {
      service.getSkillRegistry().clear();
      setMessages([]);
    },

    setMode(newMode: "full" | "plan"): void {
      service.setMode(newMode);
      setModeState(newMode);
      setPermMode(service.currentPermissionMode);
    },

    getMode(): "full" | "plan" {
      return mode;
    },

    setPermissionMode(newPerm: PermissionMode): void {
      service.setPermissionMode(newPerm);
      setPermMode(newPerm);
    },

    getTokenUsage() {
      return usage;
    },

    triggerCompact(): void {
      service.compact();
    },

    refreshStatus(): void {
      // 强制触发状态栏刷新（通过更新 mode state 的引用）
      setModeState((prev) => prev);
    },

    getContextInfo() {
      return service.getContextInfo();
    },
  }), [service, handleAISubmit, mode, usage]);

  // MCP 初始化（仅首次挂载时执行）
  useEffect(() => {
    service.init().then(() => {
      // MCP 连接完成后刷新计数，确保 InfoBar 展示正确的 MCP×N
      setMcpCount(service.mcpCount);
      setToolCount(service.toolCount);
    });
  }, [service]);

  // 注入回调到 ChatService
  useEffect(() => {
    service.setHumanInTheLoop(humanInTheLoop);
  }, [service, humanInTheLoop]);


  // 权限确认按键处理（只在权限弹窗激活时）
  useInput((input, key) => {
    if (!permissionPrompt) return;

    const resolve = permissionResolveRef.current;
    if (!resolve) return;

    const ch = input.toLowerCase();
    if (ch === "y") {
      permissionResolveRef.current = null;
      setPermissionPrompt(null);
      resolve("yes");
    } else if (ch === "n") {
      permissionResolveRef.current = null;
      setPermissionPrompt(null);
      resolve("no");
    } else if (ch === "a") {
      permissionResolveRef.current = null;
      setPermissionPrompt(null);
      resolve("always_allow");
    }
  });

  // Ctrl+C
  // 注意：Ctrl+T/Ctrl+E 在 InputBox 中处理（避免被 TextInput 拦截）
  useInput((input, key) => {
    if (permissionPrompt) return; // 权限弹窗激活时不响应其他按键
    if (key.ctrl && input === "c" && isStreaming) {
      service.cancel();
    }
  });

  // 提交消息 — 分流器入口
  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // 命令分流
    if (text.startsWith("/")) {
      const parsed = parseCommand(text);

      if (parsed.isCommand) {
        const cmd = registry.get(parsed.name);
        if (cmd) {
          dispatch(cmd, parsed.args, uiContext);
          return;
        } else {
          uiContext.showMessage(
            `未知命令: /${parsed.name}。输入 /help 查看可用命令。`,
            "warning",
          );
          return;
        }
      }
    }

    // 非命令 → AI 对话
    await handleAISubmit(text);
  }, [registry, uiContext, handleAISubmit]);

  return (
    <Box flexDirection="column" padding={1}>
      {/* 启动横幅：整个会话期间始终展示在顶部 */}
      <StartupBanner
        version={pkg.version}
        model={service.currentModel}
        cwd={process.cwd()}
      />

      <ChatView
        messages={messages}
        streamingContent={streamingContent}
        toolStatus={toolStatus}
        expandedTools={expandedTools}
      />

      {/* 权限确认弹窗 */}
      {permissionPrompt && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color="yellow" bold>🔒 权限确认</Text>
          </Box>
          <Box marginTop={1}>
            <Text>操作：</Text>
            <Text bold>{permissionPrompt.toolCall}</Text>
          </Box>
          <Box>
            <Text dimColor>原因：{permissionPrompt.reason}</Text>
          </Box>
          <Box marginTop={1}>
            <Text color="green">[y] 是</Text>
            <Text>  </Text>
            <Text color="red">[n] 否</Text>
            <Text>  </Text>
            <Text color="cyan">[a] 始终允许</Text>
          </Box>
        </Box>
      )}

      {streamingThinking && (
        <ThinkingBox thinking={streamingThinking} collapsed={thinkingCollapsed} />
      )}

      <InputBox
        onSubmit={handleSubmit}
        disabled={isStreaming || !!permissionPrompt}
        error={error ?? undefined}
        registry={registry}
        onToggleThinking={() => setThinkingCollapsed((prev) => !prev)}
        onToggleTools={() =>
          setExpandedTools((prev) => {
            if (prev.size > 0) return new Set();
            const allIds = new Set<string>();
            for (const msg of service.history) {
              if (msg.toolResults) {
                for (const tr of msg.toolResults) {
                  allIds.add(tr.toolUseId);
                }
              }
            }
            return allIds;
          })
        }
      />

      <InfoBar
        model={service.currentModel}
        usage={usage ?? undefined}
        streaming={isStreaming}
        messageCount={service.history.length}
        currentRound={currentRound}
        maxRounds={service.maxRounds}
        permissionMode={permMode}
        toolCount={toolCount}
        mcpCount={mcpCount}
        skillCount={service.skillCount}
        activeSkillCount={service.activeSkillCount}
        agentRoleCount={service.agentRoleCount}
        sessionFile={basename(service.sessionPath)}
      />
    </Box>
  );
}
