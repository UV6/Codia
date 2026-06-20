import { Text, Box } from "ink";

interface InfoBarProps {
  mode: "full" | "plan";
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

// InfoBar —— 底部固定信息栏，始终展示对话运行时状态
// 替代原来的 StatusBar，信息更全面，放在输入框下方
export function InfoBar({
  mode,
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
  const modeLabel = mode === "plan" ? "PLAN" : "DEFAULT";

  return (
    <Box
      borderStyle="round"
      borderColor="green"
      flexDirection="column"
      paddingX={1}
      width="100%"
    >
      {/* 第一行：会话状态 */}
      <Box flexDirection="row">
        <Text color="yellow">⬡ {modeLabel}</Text>
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
        {!streaming && (
          <Text dimColor>🔒 {permMode}</Text>
        )}
      </Box>

      {/* 第二行：系统状态 */}
      <Box flexDirection="row">
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
      <Box>
        <Text color="grey" dimColor>
          ⌨ Ctrl+C 取消 | Ctrl+T 折叠思考 | /status 查看状态 | /session 会话信息
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
