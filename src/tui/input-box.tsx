import { useState } from "react";
import { Text, Box, useInput } from "ink";
import TextInput from "ink-text-input";
import type { CommandRegistry } from "../command/registry.js";

interface InputBoxProps {
  onSubmit: (text: string) => void;
  disabled: boolean;
  error?: string;
  registry?: CommandRegistry;
}

// InputBox —— 用户输入区域，类似 Claude Code 的 "Codia >" 前缀
export function InputBox({ onSubmit, disabled, error, registry }: InputBoxProps) {
  const [value, setValue] = useState("");
  const [completions, setCompletions] = useState<string[]>([]);

  const handleSubmit = (text: string) => {
    if (!text.trim()) return;
    setValue("");
    setCompletions([]);
    onSubmit(text);
  };

  // Tab 补全：只在非 disabled 且有 registry 时处理
  useInput((input, key) => {
    if (disabled) return;
    if (!registry) return;

    if (key.tab && !key.ctrl && !key.meta) {
      const currentValue = value;
      // 非 / 开头不触发命令补全
      if (!currentValue.startsWith("/")) return;

      // 提取前缀（不含 /）
      const prefix = currentValue.slice(1);
      const matches = registry.getMatches(prefix);

      if (matches.length === 1) {
        // 单匹配：直接补全
        setValue(`/${matches[0].name} `);
        setCompletions([]);
      } else if (matches.length > 1) {
        // 多匹配：展示候选列表
        const names = matches.map((c) => `/${c.name}`).sort();
        setCompletions(names);
      }
    }
  });

  return (
    <Box borderStyle="round" borderColor="greenBright" flexDirection="column" paddingX={1} width="100%">
      {error && <Text color="red">✗ {error}</Text>}
      {completions.length > 0 && (
        <Box marginBottom={0}>
          <Text dimColor>
            {completions.map((name, i) => (
              <Text key={name}>
                {i > 0 && "  "}
                {name}
              </Text>
            ))}
          </Text>
        </Box>
      )}
      <Box>
        <Text color="greenBright">▶</Text>
        <Text> </Text>
        <Text color="cyan" bold>
          Codia
        </Text>
        <Text> </Text>
        <Text color="yellow">{"> "}</Text>
        {disabled ? (
          <Text dimColor>...</Text>
        ) : (
          <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
        )}
      </Box>
    </Box>
  );
}
