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
  // markdown 专用
  "hljs-strong": "white",
  "hljs-emphasis": "white",
  "hljs-link": "blue",
  "hljs-code": "yellow",
  "hljs-bullet": "yellow",
  "hljs-quote": "grey",
  "hljs-formula": "white",
};

// 解析单行 highlight.js HTML 为带颜色的文本段
// 用栈支持嵌套 <span>，避免内层 span 打破外层解析
export function parseHighlightedLine(line: string): Segment[] {
  if (!line) return [];

  const segments: Segment[] = [];
  const spanTagRe = /<span class="([^"]*)">/;
  const closeTag = "</span>";
  const stack: string[] = []; // 颜色栈，最内层在栈顶
  let chars = "";
  let i = 0;

  while (i < line.length) {
    const rest = line.slice(i);

    // 匹配开标签
    const openMatch = rest.match(spanTagRe);
    if (openMatch && openMatch.index === 0) {
      // 先提交当前累积的文本
      if (chars) {
        const color = stack.length > 0 ? stack[stack.length - 1] : undefined;
        segments.push({ text: chars, color });
        chars = "";
      }
      const classes = openMatch[1].split(" ");
      const color = classes.map((c) => CLASS_COLOR_MAP[c]).find(Boolean);
      stack.push(color || "white");
      i += openMatch[0].length;
      continue;
    }

    // 匹配闭标签
    if (rest.startsWith(closeTag)) {
      if (chars) {
        const color = stack.length > 0 ? stack[stack.length - 1] : undefined;
        segments.push({ text: chars, color });
        chars = "";
      }
      stack.pop();
      i += closeTag.length;
      continue;
    }

    // &amp; → &, &lt; → <, &gt; → >, &quot; → "
    if (rest.startsWith("&amp;")) {
      chars += "&";
      i += 5;
      continue;
    }
    if (rest.startsWith("&lt;")) {
      chars += "<";
      i += 4;
      continue;
    }
    if (rest.startsWith("&gt;")) {
      chars += ">";
      i += 4;
      continue;
    }
    if (rest.startsWith("&quot;")) {
      chars += '"';
      i += 6;
      continue;
    }

    chars += line[i];
    i++;
  }

  // 残余文本
  if (chars) {
    segments.push({ text: chars });
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
