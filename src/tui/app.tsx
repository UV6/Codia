import { useState, useEffect } from "react";
import { Box } from "ink";
import { useInput } from "ink";
import { InputBox } from "./input-box.js";
import { ChatView } from "./chat-view.js";
import { ThinkingBox } from "./thinking-box.js";
import { StatusBar } from "./status-bar.js";
import type { Message } from "../provider/types.js";
import type { ChatService } from "../chat/chat-service.js";

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

  // 订阅用量回调
  useEffect(() => {
    service.onUsage = (u) => setUsage(u);
  }, [service]);

  // Ctrl+C 取消流式
  useInput((input, key) => {
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

      {streamingThinking && (
        <ThinkingBox thinking={streamingThinking} collapsed={thinkingCollapsed} />
      )}

      <StatusBar
        model={service["config"]?.["model"] ?? "unknown"}
        usage={usage ?? undefined}
        streaming={isStreaming}
      />

      <InputBox onSubmit={handleSubmit} disabled={isStreaming} error={error ?? undefined} />
    </Box>
  );
}
