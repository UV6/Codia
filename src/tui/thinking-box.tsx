import { Text, Box } from "ink";

interface ThinkingBoxProps {
  thinking: string;
  collapsed: boolean;
}

// ThinkingBox —— Claude extended thinking 内容展示
// 灰色/斜体，点击 Ctrl+T 折叠/展开
export function ThinkingBox({ thinking, collapsed }: ThinkingBoxProps) {
  if (!thinking && !collapsed) return null;

  if (collapsed) {
    return (
      <Box marginTop={0}>
        <Text color="grey" italic>
          {"<Thinking... (Ctrl+T 展开)>"}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="grey" italic>
        {"--- thinking ---"}
      </Text>
      <Text color="grey" italic>
        {thinking}
      </Text>
      <Text color="grey" italic>
        {"--- end thinking ---"}
      </Text>
    </Box>
  );
}
