import { Text, Box } from "ink";
import type { Message } from "../provider/types.js";
import type { ToolResult } from "../tool/types.js";
import { MarkdownRenderer } from "./markdown-renderer.js";

interface ChatViewProps {
  messages: Message[];
  streamingContent?: string;
  toolStatus?: string | null;
  expandedTools?: Set<string>;
}

// TOOL_ICONS —— 内置工具对应的展示图标
const TOOL_ICONS: Record<string, string> = {
  read_file: "\u{1F4D6}",   // 📖
  write_file: "\u{270F}\u{FE0F}",  // ✏️
  edit_file: "\u{2702}\u{FE0F}",   // ✂️
  glob: "\u{1F50D}",         // 🔍
  grep: "\u{1F50E}",         // 🔎
  run_command: "\u{1F4BB}",  // 💻
};

// DEFAULT_ICON —— 未知/MCP 工具默认图标
const DEFAULT_ICON = "\u{1F527}"; // 🔧

// formatBytes —— 字节数转人类可读
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// formatDuration —— 毫秒转秒
function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// renderToolSummary —— 根据工具名、metadata 和展示参数生成一行摘要
function renderToolSummary(
  name: string | undefined,
  metadata: ToolResult["metadata"],
  inputPreview: string | undefined,
  status: ToolResult["status"],
): string {
  // 旧数据 fallback
  if (!name) return `${DEFAULT_ICON} 工具结果`;

  const icon = TOOL_ICONS[name] ?? DEFAULT_ICON;
  const detail = buildDetail(name, metadata);

  if (status === "error") {
    return `${icon} ${inputPreview || name} 执行失败${detail ? ` (${detail})` : ""}`;
  }

  switch (name) {
    case "read_file":
      return `${icon} 读取了 ${inputPreview || "?"}${detail ? ` (${detail})` : ""}`;
    case "write_file":
      return `${icon} 写入了 ${inputPreview || "?"}${detail ? ` (${detail})` : ""}`;
    case "edit_file":
      return `${icon} 编辑了 ${inputPreview || "?"}${detail ? ` (${detail})` : ""}`;
    case "glob":
      return `${icon} 搜索 ${inputPreview ? `"${inputPreview}"` : ""} 匹配 ${detail || "?"} 个文件`;
    case "grep":
      return `${icon} 搜索 ${inputPreview ? `"${inputPreview}"` : ""} 找到 ${detail || "?"} 处匹配`;
    case "run_command":
      return `${icon} ${inputPreview || "?"}${detail ? ` (${detail})` : ""}`;
    default:
      return `${icon} ${name} 完成`;
  }
}

// buildDetail —— 从 metadata 构建括号内的补充信息
function buildDetail(name: string, metadata: ToolResult["metadata"]): string {
  if (!metadata) return "";
  const parts: string[] = [];
  switch (name) {
    case "read_file":
    case "grep":
      if (metadata.lineCount !== undefined) parts.push(`${metadata.lineCount} 行`);
      break;
    case "glob":
      if (metadata.fileCount !== undefined) parts.push(`${metadata.fileCount} 个文件`);
      break;
    case "write_file":
      if (metadata.bytesWritten !== undefined) parts.push(formatBytes(metadata.bytesWritten));
      break;
    case "run_command":
      if (metadata.exitCode !== undefined) parts.push(`exit: ${metadata.exitCode}`);
      if (metadata.duration !== undefined) parts.push(formatDuration(metadata.duration));
      break;
  }
  return parts.join(", ");
}

// ChatView —— 消息列表 + 流式渲染
export function ChatView({
  messages,
  streamingContent,
  toolStatus,
  expandedTools,
}: ChatViewProps) {
  return (
    <Box flexDirection="column">
      {messages.map((msg, i) => {
        if (msg.role === "user") {
          // 工具结果消息：渲染为紧凑摘要行
          if (msg.toolResults && msg.toolResults.length > 0) {
            return (
              <Box key={i} marginTop={i > 0 ? 1 : 0} flexDirection="column">
                {msg.toolResults.map((tr, j) => {
                  const isExpanded = expandedTools?.has(tr.toolUseId);
                  return (
                    <Box key={j} flexDirection="column">
                      <Text
                        color={
                          tr.result.status === "error" ? "red" : "green"
                        }
                        dimColor={!isExpanded}
                      >
                        {renderToolSummary(
                          tr.name,
                          tr.result.metadata,
                          tr.inputPreview,
                          tr.result.status,
                        )}
                      </Text>
                      {isExpanded && (
                        <Box
                          marginTop={0}
                          paddingLeft={2}
                          borderStyle="single"
                          borderColor="grey"
                        >
                          <Text dimColor>{tr.result.content}</Text>
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            );
          }

          // 普通用户消息
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
              <MarkdownRenderer text={msg.content} />
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
          <MarkdownRenderer text={streamingContent} isStreaming={true} />
        </Box>
      )}
    </Box>
  );
}
