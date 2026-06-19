import { Text, Box } from "ink";

interface StatusBarProps {
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  streaming: boolean;
  mode: "full" | "plan";
}

// StatusBar —— 底部状态栏，显示模型名和 token 用量
export function StatusBar({ model, usage, streaming, mode }: StatusBarProps) {
  const modeLabel = mode === "plan" ? "[PLAN]" : "[DEFAULT]";
  return (
    <Box marginTop={1}>
      <Text dimColor>
        {modeLabel} Model: {model}
      </Text>
      {streaming && (
        <Text dimColor> 回答中...</Text>
      )}
      {usage && !streaming && (
        <Text dimColor>
          {" "}in:{usage.inputTokens} out:{usage.outputTokens}
        </Text>
      )}
    </Box>
  );
}
