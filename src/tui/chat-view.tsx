import { Text, Box } from "ink";
import type { Message } from "../provider/types.js";

interface ChatViewProps {
  messages: Message[];
  streamingContent?: string;
}

// ChatView —— 消息列表 + 流式渲染
export function ChatView({ messages, streamingContent }: ChatViewProps) {
  return (
    <Box flexDirection="column">
      {messages.map((msg, i) => {
        const time = new Date(msg.timestamp).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        if (msg.role === "user") {
          return (
            <Box key={i} marginTop={i > 0 ? 1 : 0}>
              <Text color="cyan" bold>
                {"> "}
              </Text>
              <Text>{msg.content}</Text>
              <Text dimColor> ({time})</Text>
            </Box>
          );
        }

        if (msg.role === "assistant") {
          return (
            <Box key={i} marginTop={1} flexDirection="column">
              <Text color="green">{msg.content}</Text>
              {(msg.usage || msg.thinking) && (
                <Box marginTop={1}>
                  {msg.thinking && (
                    <Text color="grey" italic>
                      {"<已思考>"}
                    </Text>
                  )}
                  {msg.usage && (
                    <Text dimColor>
                      {" "}
                      Model: {msg.usage.model} in:{msg.usage.inputTokens} out:
                      {msg.usage.outputTokens}
                    </Text>
                  )}
                </Box>
              )}
              <Text dimColor> ({time})</Text>
            </Box>
          );
        }

        // role === "system" (错误消息)
        return (
          <Box key={i} marginTop={1}>
            <Text color="red">{msg.content}</Text>
          </Box>
        );
      })}

      {/* 流式渲染中的内容 */}
      {streamingContent && (
        <Box marginTop={messages.length > 0 ? 0 : 0}>
          <Text color="green">{streamingContent}</Text>
        </Box>
      )}
    </Box>
  );
}
