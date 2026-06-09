import { useState } from "react";
import { Text, Box } from "ink";
import TextInput from "ink-text-input";

interface InputBoxProps {
  onSubmit: (text: string) => void;
  disabled: boolean;
  error?: string;
}

// InputBox —— 用户输入区域，类似 Claude Code 的 "Codia >" 前缀
export function InputBox({ onSubmit, disabled, error }: InputBoxProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (text: string) => {
    if (!text.trim()) return;
    setValue("");
    onSubmit(text);
  };

  return (
    <Box flexDirection="column">
      {error && <Text color="red">✗ {error}</Text>}
      <Box>
        <Text color="cyan" bold>
          Codia{" "}
        </Text>
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
