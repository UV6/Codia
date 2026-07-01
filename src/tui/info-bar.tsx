import { Text, Box } from "ink";

interface InfoBarProps {
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  replyStatusLabel?: string | null;
  messageCount: number;
  currentRound: number;
  maxRounds: number;
  permissionMode: string;
  toolCount: number;
  mcpCount: number;
  skillCount: number;
  activeSkillCount: number;
  agentRoleCount: number;
  sessionFile: string;
  contextTokens: number;
  contextMax: number;
}

// statusConfig —— 权限模式 → 显示配置
interface StatusConfig {
  label: string;
  color: string;
}

export function formatAgentRoleLabel(agentRoleCount: number): string {
  return `Agent×${agentRoleCount}`;
}

const MAX_SESSION_FILE_LENGTH = 24;

export function formatSessionFileLabel(sessionFile: string): string {
  if (sessionFile.length <= MAX_SESSION_FILE_LENGTH) {
    return `📁 ${sessionFile}`;
  }
  return `📁 ${sessionFile.slice(0, MAX_SESSION_FILE_LENGTH)}…`;
}

function getStatusConfig(permMode: string): StatusConfig {
  switch (permMode) {
    case "bypassPermissions":
      return { label: "⚠ 危险模式", color: "red" };
    case "plan":
      return { label: "📋 PLAN", color: "blue" };
    case "acceptsEdit":
      return { label: "✏️ ACCEPT_EDITS", color: "magenta" };
    default:
      return { label: "⬡ DEFAULT", color: "green" };
  }
}

// InfoBar —— 底部固定信息栏，始终展示对话运行时状态
export function InfoBar({
  model,
  usage,
  replyStatusLabel,
  messageCount,
  currentRound,
  maxRounds,
  permissionMode: permMode,
  toolCount,
  mcpCount,
  skillCount,
  activeSkillCount,
  agentRoleCount,
  sessionFile,
  contextTokens,
  contextMax,
}: InfoBarProps) {
  const status = getStatusConfig(permMode);

  return (
    <Box flexDirection="column" width="100%" marginTop={0}>
      {/* 第一行：权限模式 + 模型 + 用量 */}
      <Box flexDirection="row" paddingLeft={1}>
        <Text color={status.color}>{status.label}</Text>
        <Text>  </Text>
        <Text color="blue">🧠 {model}</Text>
        <Text>  </Text>
        {usage ? (
          <Text color="orange">
            📊 in:{formatTokens(usage.inputTokens)} out:{formatTokens(usage.outputTokens)}
          </Text>
        ) : (
          <Text dimColor>📊 --</Text>
        )}
        <Text>  </Text>
        <Text dimColor>📐 {formatTokens(contextTokens)}/{formatTokens(contextMax)}</Text>
        <Text>  </Text>
        <Text dimColor>💬 {messageCount}</Text>
        <Text>  </Text>
        <Text dimColor>🔄 {currentRound}/{maxRounds}</Text>
        <Text>  </Text>
        {replyStatusLabel && (
          <Text color="green">⚡ {replyStatusLabel}</Text>
        )}
      </Box>

      {/* 第二行：系统状态 */}
      <Box flexDirection="row" paddingLeft={1}>
        <Text dimColor>🔧 {toolCount}</Text>
        <Text>  </Text>
        <Text dimColor>🔌 MCP×{mcpCount}</Text>
        <Text>  </Text>
        {activeSkillCount > 0 ? (
          <Text color="blue">🎯 Skills×{skillCount}({activeSkillCount}激活)</Text>
        ) : (
          <Text dimColor>🎯 Skills×{skillCount}</Text>
        )}
        <Text>  </Text>
        <Text dimColor>🏗️ </Text>
        <Text dimColor>{formatAgentRoleLabel(agentRoleCount)}</Text>
        <Text>  </Text>
        <Text dimColor>{formatSessionFileLabel(sessionFile)}</Text>
      </Box>

      {/* 第三行：快捷键提示 */}
      <Box paddingLeft={1}>
        <Text color="grey" dimColor>
          ⌨ Ctrl+C 取消 | Ctrl+T 折叠思考 | /context 查看上下文 | /session 会话信息
        </Text>
      </Box>
    </Box>
  );
}

// 格式化 token 数为 k 单位
function formatTokens(n: number): string {
  if (n >= 1000) {
    return (n / 1000).toFixed(1) + "k";
  }
  return String(n);
}
