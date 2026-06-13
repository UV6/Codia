import { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import { InputBox } from "./input-box.js";
import { ChatView } from "./chat-view.js";
import { ThinkingBox } from "./thinking-box.js";
import { StatusBar } from "./status-bar.js";
import type { Message } from "../provider/types.js";
import type { ChatService } from "../chat/chat-service.js";
import type { HumanChoice, HumanPrompt } from "../permission/types.js";

interface AppProps {
  service: ChatService;
}

// App —— Ink 根组件，管理全局状态
export function App({ service }: AppProps) {
  const [messages, setMessages] = useState<Message[]>(service.history);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [streamingThinking, setStreamingThinking] = useState<string>("");
  const [thinkingCollapsed, setThinkingCollapsed] = useState(false);
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number; model: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);

  // 权限确认状态
  const [permissionPrompt, setPermissionPrompt] = useState<HumanPrompt | null>(null);
  // 用 ref 存储 resolve 回调，避免放到 state 里
  const permissionResolveRef = useRef<((choice: HumanChoice) => void) | null>(null);

  // 人在回路回调：设置状态 + 返回 Promise
  const humanInTheLoop = useCallback((prompt: HumanPrompt): Promise<HumanChoice> => {
    return new Promise<HumanChoice>((resolve) => {
      permissionResolveRef.current = resolve;
      setPermissionPrompt(prompt);
    });
  }, []);

  // 注入回调到 ChatService
  useEffect(() => {
    service.setHumanInTheLoop(humanInTheLoop);
  }, [service, humanInTheLoop]);

  // 订阅用量回调
  useEffect(() => {
    service.onUsage = (u) => setUsage(u);
  }, [service]);

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

  // Ctrl+C / Ctrl+T
  useInput((input, key) => {
    if (permissionPrompt) return; // 权限弹窗激活时不响应其他按键
    if (key.ctrl && input === "c" && isStreaming) {
      service.cancel();
    }
    if (key.ctrl && input === "t") {
      setThinkingCollapsed((prev) => !prev);
    }
  });

  // 提交消息
  const handleSubmit = async (text: string) => {
    if (!text.trim()) return;

    setError(null);
    setStreamingContent("");
    setStreamingThinking("");
    setToolStatus(null);
    setUsage(null);
    setThinkingCollapsed(false);
    setIsStreaming(true);

    // 立即把用户消息加入视图
    const userMsg: Message = {
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    let fullContent = "";
    let fullThinking = "";

    try {
      for await (const chunk of service.sendMessage(text)) {
        switch (chunk.type) {
          case "text":
            fullContent += chunk.content;
            setStreamingContent(fullContent);
            break;
          case "thinking":
            fullThinking += chunk.content;
            setStreamingThinking(fullThinking);
            break;
          case "usage":
            setUsage(chunk.usage);
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
  };

  return (
    <Box flexDirection="column" padding={1}>
      <ChatView
        messages={messages}
        streamingContent={streamingContent}
        toolStatus={toolStatus}
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

      <StatusBar
        model={service["config"]?.["model"] ?? "unknown"}
        usage={usage ?? undefined}
        streaming={isStreaming}
      />

      <InputBox onSubmit={handleSubmit} disabled={isStreaming || !!permissionPrompt} error={error ?? undefined} />
    </Box>
  );
}
