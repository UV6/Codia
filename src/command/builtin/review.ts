import type { CommandDef } from "../types.js";

const REVIEW_PROMPT = `请对当前代码变更进行代码审查，从以下几个维度分析：

1. **正确性** — 逻辑是否正确，是否有 bug
2. **可读性** — 代码是否清晰易懂
3. **架构** — 模块划分是否合理，依赖是否清晰
4. **安全性** — 是否存在安全风险
5. **性能** — 是否有性能问题

请给出具体的审查结论和改进建议。`;

export const reviewCommand: CommandDef = {
  name: "review",
  aliases: ["cr"],
  description: "触发代码审查",
  usage: "/review",
  type: "prompt",
  promptText: REVIEW_PROMPT,
  handler: () => {}, // prompt 型由 dispatcher 直接取 promptText 注入，handler 留空
};
