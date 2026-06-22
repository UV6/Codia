import { Text, Box } from "ink";
import hljs from "highlight.js";

interface CodeBlockProps {
  code: string;
  language?: string;
}

interface Segment {
  text: string;
  color?: string;
}

// highlight.js class → Ink 颜色映射
const CLASS_COLOR_MAP: Record<string, string> = {
  "hljs-keyword": "magenta",
  "hljs-string": "green",
  "hljs-comment": "grey",
  "hljs-number": "yellow",
  "hljs-title": "cyan",
  "hljs-type": "cyan",
  "hljs-literal": "yellow",
  "hljs-built_in": "cyan",
  "hljs-function": "blue",
  "hljs-params": "white",
  "hljs-meta": "grey",
  "hljs-attr": "yellow",
  "hljs-attribute": "yellow",
  "hljs-selector-class": "yellow",
  "hljs-selector-tag": "magenta",
  "hljs-template-variable": "magenta",
  "hljs-variable": "white",
  "hljs-symbol": "yellow",
  "hljs-regexp": "red",
  "hljs-addition": "green",
  "hljs-deletion": "red",
  "hljs-section": "cyan",
  "hljs-subst": "white",
  "hljs-name": "cyan",
  "hljs-tag": "magenta",
  "hljs-property": "cyan",
  "hljs-operator": "white",
  "hljs-punctuation": "white",
};

// 解析单行 highlight.js HTML，提取带颜色的文本段
export function parseHighlightedLine(line: string): Segment[] {
  if (!line) return [];

  const segments: Segment[] = [];
  const regex = /<span class="([^"]*)">([^<]*)<\/span>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    // span 前的纯文本
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index) });
    }

    // 取第一个匹配的颜色 class
    const classes = match[1].split(" ");
    const color = classes.map((c) => CLASS_COLOR_MAP[c]).find(Boolean);
    segments.push({ text: match[2], color });

    lastIndex = match.index + match[0].length;
  }

  // 尾部纯文本
  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ text: line }];
}

// CodeBlock —— 语法高亮代码块
export function CodeBlock({ code, language }: CodeBlockProps) {
  let html: string;
  let detectedLang: string | undefined;

  if (language && hljs.getLanguage(language)) {
    const result = hljs.highlight(code, { language });
    html = result.value;
    detectedLang = language;
  } else {
    const result = hljs.highlightAuto(code);
    html = result.value;
    detectedLang = result.language || undefined;
  }

  const lines = html.split("\n");
  // 去掉末尾空行
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="grey" paddingX={1}>
      {detectedLang && (
        <Text dimColor>{detectedLang}</Text>
      )}
      {lines.map((line, lineIdx) => {
        const segments = parseHighlightedLine(line);
        return (
          <Box key={lineIdx} flexDirection="row">
            {segments.map((seg, segIdx) => (
              <Text key={segIdx} color={seg.color}>
                {seg.text}
              </Text>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
