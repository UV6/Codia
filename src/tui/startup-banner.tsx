import { Text, Box } from "ink";

interface StartupBannerProps {
  version: string;
  model: string;
  cwd: string;
}

// Codia 卡通鱼图案 — "cod" fish + 终端 >_ 提示符元素
const LOGO_LINES = [
  "     ♕     ",
  "  ▐▛███▜▌  ",
  " ▝▜█████▛▘  ",
  "   ▘▘ ▝▝    ",
];

// StartupBanner — 启动时展示 Codia 卡通形象 + 版本/模型/目录
export function StartupBanner({ version, model, cwd }: StartupBannerProps) {
  return (
    <Box flexDirection="row" marginBottom={1}>
      {/* 左侧：卡通鱼图案 */}
      <Box flexDirection="column" marginRight={3}>
        {LOGO_LINES.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
      {/* 右侧：版本信息 */}
      <Box flexDirection="column" justifyContent="center">
        <Text bold color="cyan">
          Codia v{version}
        </Text>
        <Text>{model}</Text>
        <Text dimColor>{cwd}</Text>
      </Box>
    </Box>
  );
}
