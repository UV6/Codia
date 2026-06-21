import { Text, Box } from "ink";

interface InfoBarProps {
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  streaming: boolean;
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
}

// statusConfig —— 权限模式 → 显示配置
interface StatusConfig {
  label: string;
  color: string;
}
function getStatusConfig(permMode: string): StatusConfig {
  switch (permMode) {
    case "bypassPermissions":
      return { label: "⚠ 危险模式", color: "red" };
    case "plan":
      return { label: "📋 PLAN", color: "blue" };
    case "acceptEdits":
      return { label: "✏️ ACCEPT_EDITS", color: "magenta" };
    default:
      return { label: "⬡ DEFAULT", color: "green" };
  }
}

// InfoBar —— 底部固定信息栏，始终展示对话运行时状态
// 只有上下边框，无左右边框
export function InfoBar({
  model,
  usage,
  streaming,
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
}: InfoBarProps) {
  const status = getStatusConfig(permMode);
  const borderColor = status.color;

  return (
    <Box flexDirection="column" width="100%" marginTop={0}>
      {/* 上边框 */}
      <Text color={borderColor}>{"─".repeat(80)}</Text>

      {/* 第一行：权限模式 + 模型 + 用量 */}
      <Box flexDirection="row" paddingLeft={1}>
        <Text color={status.color}>{status.label}</Text>
        <Text>  </Text>
        <Text color="blue">🧠 {model}</Text>
        <Text>  </Text>
        {usage ? (
          <Text color="orange">
            📊 {formatTokens(usage.inputTokens)}/{formatTokens(usage.outputTokens)}
          </Text>
        ) : (
          <Text dimColor>📊 --/--</Text>
        )}
        <Text>  </Text>
        <Text dimColor>💬 {messageCount}</Text>
        <Text>  </Text>
        <Text dimColor>🔄 {currentRound}/{maxRounds}</Text>
        <Text>  </Text>
        {streaming && (
          <Text color="green">⚡ 输出中...</Text>
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
        <Text dimColor>🏗️ Agents×{agentRoleCount}</Text>
        <Text>  </Text>
        <Text dimColor>📁 {sessionFile}</Text>
      </Box>

      {/* 第三行：快捷键提示 */}
      <Box paddingLeft={1}>
        <Text color="grey" dimColor>
          ⌨ Ctrl+C 取消 | Ctrl+T 折叠思考 | /status 查看状态 | /session 会话信息
        </Text>
      </Box>

      {/* 下边框 */}
      <Text color={borderColor}>{"─".repeat(80)}</Text>
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
