import { Text, Box } from "ink";
import type { Message } from "../provider/types.js";

interface ChatViewProps {
  messages: Message[];
  streamingContent?: string;
  toolStatus?: string | null;
}

// ChatView —— 消息列表 + 流式渲染
export function ChatView({ messages, streamingContent, toolStatus }: ChatViewProps) {
  return (
    <Box flexDirection="column">
      {messages.map((msg, i) => {
        if (msg.role === "user") {
          return (
            <Box key={i} marginTop={i > 0 ? 1 : 0}>
              <Text color="cyan" bold>
                {"> "}
              </Text>
              <Text>{msg.content}</Text>
            </Box>
          );
        }

        if (msg.role === "assistant") {
          return (
            <Box key={i} marginTop={1} flexDirection="column">
              <Text color="green">{msg.content}</Text>
              {msg.thinking && (
                <Box marginTop={1}>
                  <Text color="grey" italic>
                    {"<已思考>"}
                  </Text>
                </Box>
              )}
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

      {/* 工具调用状态 */}
      {toolStatus && (
        <Box marginTop={messages.length > 0 ? 1 : 0}>
          <Text color="blue">{toolStatus}</Text>
        </Box>
      )}

      {/* 流式渲染中的内容 */}
      {streamingContent && (
        <Box marginTop={messages.length > 0 ? 0 : 0}>
          <Text color="green">{streamingContent}</Text>
        </Box>
      )}
    </Box>
  );
}
