import { Text, Box } from "ink";
import { marked } from "marked";
import type { Token, Tokens } from "marked";
import { CodeBlock } from "./code-block.js";

interface MarkdownRendererProps {
  text: string;
  isStreaming?: boolean;
}

// 流式渲染时检测末尾是否有未闭合的围栏代码块
// 有则拆分为「安全部分」和「降级部分」
export function splitUnclosedFence(
  text: string,
): { safe: string; tail: string } {
  const lines = text.split("\n");
  let fenceCount = 0;
  let lastFenceLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) {
      fenceCount++;
      lastFenceLineIndex = i;
    }
  }

  if (fenceCount % 2 === 1 && lastFenceLineIndex >= 0) {
    const safe = lines.slice(0, lastFenceLineIndex).join("\n");
    const tail = lines.slice(lastFenceLineIndex).join("\n");
    return { safe, tail };
  }

  return { safe: text, tail: "" };
}

// MarkdownRenderer —— 将 Markdown 文本渲染为 Ink 组件
// isStreaming 时开启优雅降级：未闭合的代码块以纯文本展示
export function MarkdownRenderer({ text, isStreaming }: MarkdownRendererProps) {
  if (!text) return null;

  try {
    let content = text;
    let tail = "";

    if (isStreaming) {
      const result = splitUnclosedFence(text);
      content = result.safe;
      tail = result.tail;
    }

    if (!content && !tail) return null;

    const tokens = content ? marked.lexer(content) : [];

    return (
      <Box flexDirection="column">
        {tokens.map((token, i) => renderBlockToken(token, i))}
        {tail ? <Text>{tail}</Text> : null}
      </Box>
    );
  } catch {
    return <Text>{text}</Text>;
  }
}

// ---- block token renderers ----

function renderBlockToken(token: Token, key: number) {
  switch (token.type) {
    case "heading":
      return renderHeading(token as Tokens.Heading, key);
    case "code":
      return (
        <CodeBlock
          key={key}
          code={(token as Tokens.Code).text}
          language={(token as Tokens.Code).lang || undefined}
        />
      );
    case "paragraph":
      return renderInlineBox(
        (token as Tokens.Paragraph).tokens ?? [],
        key,
      );
    case "list":
      return renderList(token as Tokens.List, key);
    case "blockquote":
      return renderBlockquote(token as Tokens.Blockquote, key);
    case "hr":
      return (
        <Box key={key} marginY={1}>
          <Text dimColor>{"─".repeat(40)}</Text>
        </Box>
      );
    case "space":
      return <Box key={key} height={1} />;
    default:
      if (
        "tokens" in token &&
        Array.isArray((token as Tokens.Generic).tokens)
      ) {
        return renderInlineBox(
          (token as Tokens.Generic).tokens ?? [],
          key,
        );
      }
      return <Text key={key}>{token.raw ?? ""}</Text>;
  }
}

function renderHeading(token: Tokens.Heading, key: number) {
  const colors: Record<number, string> = {
    1: "cyan",
    2: "cyan",
    3: "blue",
    4: "blue",
    5: "white",
    6: "white",
  };
  const color = colors[token.depth] || "white";

  return (
    <Box key={key} marginTop={token.depth <= 2 ? 1 : 0}>
      <Text bold color={color}>
        {token.text}
      </Text>
    </Box>
  );
}

function renderList(token: Tokens.List, key: number) {
  const { ordered, items, start = 1 } = token;
  return (
    <Box key={key} flexDirection="column" marginTop={0}>
      {items.map((item, idx) => {
        const marker = ordered
          ? `  ${Number(start) + idx}. `
          : "  • ";
        return (
          <Box key={idx} flexDirection="row">
            <Text dimColor>{marker}</Text>
            <Box flexDirection="column">
              {item.tokens
                ? item.tokens.map((t, i) =>
                    renderBlockToken(t, i),
                  )
                : renderInlineTokens(item as any, `${key}-${idx}`)}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function renderBlockquote(token: Tokens.Blockquote, key: number) {
  return (
    <Box key={key} flexDirection="row" marginTop={0}>
      <Text dimColor>│ </Text>
      <Box flexDirection="column">
        {token.tokens.map((t, i) => renderBlockToken(t, i))}
      </Box>
    </Box>
  );
}

// 将段落 tokens 包装在一个 Box 中（用于块级容器）
function renderInlineBox(tokens: Token[], key: number) {
  return (
    <Box key={key} flexDirection="row">
      {renderInlineTokens(tokens, String(key))}
    </Box>
  );
}

// ---- inline token renderers ----

function renderInlineTokens(
  tokens: Token[],
  keyPrefix: string,
): React.ReactNode[] {
  return tokens.flatMap((token, i) => {
    const key = `${keyPrefix}-${i}`;

    switch (token.type) {
      case "text":
        return (
          <Text key={key}>{token.text}</Text>
        );
      case "strong": {
        const children =
          token.tokens && token.tokens.length > 0
            ? renderInlineTokens(token.tokens, key)
            : token.text;
        return (
          <Text key={key} bold>
            {children}
          </Text>
        );
      }
      case "em": {
        const children =
          token.tokens && token.tokens.length > 0
            ? renderInlineTokens(token.tokens, key)
            : token.text;
        return (
          <Text key={key} italic>
            {children}
          </Text>
        );
      }
      case "del": {
        const children =
          token.tokens && token.tokens.length > 0
            ? renderInlineTokens(token.tokens, key)
            : token.text;
        return (
          <Text key={key} strikethrough>
            {children}
          </Text>
        );
      }
      case "codespan":
        return (
          <Text key={key} color="yellow">
            {token.text}
          </Text>
        );
      case "link":
        return (
          <Text
            key={key}
            underline
            color="blue"
          >
            {token.text}
          </Text>
        );
      case "image":
        return (
          <Text key={key} dimColor>
            [图片: {(token as any).text || ""}]
          </Text>
        );
      case "br":
        return <Text key={key}>{"\n"}</Text>;
      case "escape":
        return <Text key={key}>{token.text}</Text>;
      default:
        if (
          "tokens" in token &&
          Array.isArray((token as any).tokens)
        ) {
          return renderInlineTokens(
            (token as any).tokens,
            key,
          );
        }
        return (
          <Text key={key}>{(token as any).text ?? token.raw ?? ""}</Text>
        );
    }
  });
}
