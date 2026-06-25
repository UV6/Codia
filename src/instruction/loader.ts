import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type {
  InstructionLayer,
  InstructionLoadResult,
  ResolvedInstructionDocument,
} from "./types.js";
import type { BootstrapDiagnostic } from "../bootstrap/types.js";
import { resolveEntry } from "./resolver.js";

const MAX_INCLUDE_DEPTH = 5;
const INCLUDE_TOKEN = "@include";

// 三层入口优先级（数值越小越靠前）
const LAYERS: InstructionLayer[] = [
  {
    name: "项目根",
    priority: 1,
    scope: "project_root",
    path: "<project-root>/Codia.md",
    required: false,
  },
  {
    name: "项目私有",
    priority: 2,
    scope: "project_private",
    path: "<project-root>/.codia/Codia.md",
    required: false,
  },
  {
    name: "用户偏好",
    priority: 3,
    scope: "user",
    path: "~/.codia/Codia.md",
    required: false,
  },
];

// loadForProject —— 按三层优先级加载并拼接项目指令
export function loadForProject(projectRoot: string): InstructionLoadResult {
  const allDocuments: ResolvedInstructionDocument[] = [];
  const diagnostics: BootstrapDiagnostic[] = [];
  const resolved = resolve(projectRoot);

  // 按层收集文档
  const layerTexts: { layer: InstructionLayer; text: string }[] = [];

  for (const layer of LAYERS) {
    const layerPath = resolveLayerPath(layer, resolved);
    if (!existsSync(layerPath)) {
      if (layer.required) {
        diagnostics.push({
          source: "instruction",
          level: "warning",
          message: `必需指令层缺失：${layer.name}（${layerPath}）`,
          code: "INSTRUCTION_LAYER_MISSING",
        });
      }
      continue;
    }

    const options = {
      maxIncludeDepth: MAX_INCLUDE_DEPTH,
      projectRoot: resolved,
      allowExternalUserFile: layer.scope === "user",
      visited: new Set<string>(),
      includeToken: INCLUDE_TOKEN,
    };

    const docs = resolveEntry(layerPath, options);
    allDocuments.push(...docs);

    // 该层的文档按 depth 排序后拼接
    const layerText = docs
      .filter((d) => d.content)
      .sort((a, b) => a.depth - b.depth)
      .map((d) => d.content)
      .join("\n\n");

    if (layerText) {
      layerTexts.push({ layer, text: layerText });
    }

    for (const doc of docs) {
      for (const w of doc.warnings) {
        diagnostics.push({
          source: "instruction",
          level: "warning",
          message: `[${layer.name}] ${w}`,
          code: "INSTRUCTION_RESOLVE_WARNING",
        });
      }
    }
  }

  // 按优先级拼接，每层带来源标注，优先级高（值小）的在前
  const priorityLabels = ["最高", "中", "低"];
  const text = layerTexts
    .map(({ layer, text: t }, i) => {
      const label = priorityLabels[i] ?? String(i + 1);
      return `<!-- 来源：${layer.name}（${layer.path}），优先级：${label} -->\n${t}`;
    })
    .join("\n\n");

  return { text, documents: allDocuments, diagnostics };
}

function resolveLayerPath(layer: InstructionLayer, projectRoot: string): string {
  if (layer.scope === "user") {
    return resolve(process.env.HOME || "/", ".codia", "Codia.md");
  }
  if (layer.scope === "project_private") {
    return resolve(projectRoot, ".codia", "Codia.md");
  }
  return resolve(projectRoot, "Codia.md");
}
