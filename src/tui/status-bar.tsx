import { Text, Box } from "ink";

interface StatusBarProps {
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  streaming: boolean;
}

// StatusBar —— 底部状态栏，显示模型名和 token 用量
export function StatusBar({ model, usage, streaming }: StatusBarProps) {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        Model: {model}
      </Text>
      {streaming && (
        <Text dimColor> ...</Text>
      )}
      {usage && !streaming && (
        <Text dimColor>
          {" "}in:{usage.inputTokens} out:{usage.outputTokens}
        </Text>
      )}
    </Box>
  );
}
