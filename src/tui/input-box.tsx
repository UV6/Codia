import { useState, useEffect, useRef } from "react";
import { Text, Box, useInput } from "ink";
import TextInput from "ink-text-input";
import type { CommandRegistry } from "../command/registry.js";
import type { CommandDef } from "../command/types.js";

interface InputBoxProps {
  onSubmit: (text: string) => void;
  disabled: boolean;
  error?: string;
  registry?: CommandRegistry;
  onToggleThinking?: () => void;
  onToggleTools?: () => void;
}

// InputBox —— 用户输入区域，类似 Claude Code 的 "Codia >" 前缀
export function InputBox({ onSubmit, disabled, error, registry, onToggleThinking, onToggleTools }: InputBoxProps) {
  const [value, setValue] = useState("");
  const [completions, setCompletions] = useState<string[]>([]);
  const [showGrouped, setShowGrouped] = useState(false);
  // 标记 Ctrl 修饰键已被拦截，阻止 TextInput 将其写入输入框
  const suppressChangeRef = useRef(false);

  const handleSubmit = (text: string) => {
    if (!text.trim()) return;
    setValue("");
    setCompletions([]);
    setShowGrouped(false);
    onSubmit(text);
  };

  // 包装 setValue：当 suppressChangeRef 标记时跳过，阻止 Ctrl+字母 写入输入框
  const handleChange = (newValue: string) => {
    if (suppressChangeRef.current) {
      suppressChangeRef.current = false;
      return;
    }
    setValue(newValue);
  };

  // 输入 / 后自动展示匹配的命令、Skill 和模式
  useEffect(() => {
    if (disabled || !registry || !value.startsWith("/")) {
      setCompletions([]);
      setShowGrouped(false);
      return;
    }

    const prefix = value.slice(1);
    const matches = registry.getMatches(prefix);
    if (matches.length === 0) {
      setCompletions([]);
      setShowGrouped(false);
      return;
    }

    // 分类：prompt 型 = Skill，其余 = 内置命令/模式
    const builtins = matches.filter((c) => c.type !== "prompt");
    const skills = matches.filter((c) => c.type === "prompt");

    if (prefix === "" && (builtins.length > 0 || skills.length > 0)) {
      // 仅 / 时分组展示全部
      const lines: string[] = [];
      if (builtins.length > 0) {
        lines.push(
          "🔧 " + builtins.map((c) => `/${c.name}`).join("  "),
        );
      }
      if (skills.length > 0) {
        lines.push(
          "🎯 " + skills.map((c) => `/${c.name}`).join("  "),
        );
      }
      setCompletions(lines);
      setShowGrouped(true);
    } else {
      // 有前缀时平铺匹配项
      setCompletions(matches.map((c) => `/${c.name} — ${c.description}`));
      setShowGrouped(false);
    }
  }, [value, disabled, registry]);

  // Tab 补全 + 全局快捷键
  useInput((input, key) => {
    // 全局快捷键（不受 disabled 限制），设置 ref 阻止 TextInput 写入字符
    if (key.ctrl && input === "t") {
      suppressChangeRef.current = true;
      onToggleThinking?.();
      return;
    }
    if (key.ctrl && input === "e") {
      suppressChangeRef.current = true;
      onToggleTools?.();
      return;
    }

    if (disabled || !registry) return;

    if (key.tab && !key.ctrl && !key.meta) {
      const currentValue = value;
      if (!currentValue.startsWith("/")) return;

      const prefix = currentValue.slice(1);
      const matches = registry.getMatches(prefix);

      if (matches.length === 1) {
        setValue(`/${matches[0].name} `);
        setCompletions([]);
        setShowGrouped(false);
      }
    }
  });

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} width="100%" marginBottom={0}>
      {error && <Text color="red">✗ {error}</Text>}
      {completions.length > 0 && (
        <Box marginBottom={0} flexDirection="column">
          {completions.map((line, i) => (
            <Text key={i} dimColor={!showGrouped}>{line}</Text>
          ))}
        </Box>
      )}
      <Box>
        <Text color="cyan">▶</Text>
        <Text> </Text>
        <Text color="cyan" bold>
          Codia
        </Text>
        <Text> </Text>
        <Text color="yellow">{"> "}</Text>
        {disabled ? (
          <Text dimColor>...</Text>
        ) : (
          <TextInput value={value} onChange={handleChange} onSubmit={handleSubmit} />
        )}
      </Box>
    </Box>
  );
}
