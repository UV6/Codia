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
    path: "<project-root>/MEWCODE.md",
    required: false,
  },
  {
    name: "项目私有",
    priority: 2,
    scope: "project_private",
    path: "<project-root>/.mewcode/MEWCODE.md",
    required: false,
  },
  {
    name: "用户偏好",
    priority: 3,
    scope: "user",
    path: "~/.mewcode/MEWCODE.md",
    required: false,
  },
];

// loadForProject —— 按三层优先级加载并拼接项目指令
export function loadForProject(projectRoot: string): InstructionLoadResult {
  const documents: ResolvedInstructionDocument[] = [];
  const diagnostics: BootstrapDiagnostic[] = [];
  const resolved = resolve(projectRoot);

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
    documents.push(...docs);

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

  // 按 depth 排序拼接
  const text = documents
    .filter((d) => d.content)
    .sort((a, b) => a.depth - b.depth)
    .map((d) => d.content)
    .join("\n\n");

  return { text, documents, diagnostics };
}

function resolveLayerPath(layer: InstructionLayer, projectRoot: string): string {
  if (layer.scope === "user") {
    return resolve(process.env.HOME || "/", ".mewcode", "MEWCODE.md");
  }
  if (layer.scope === "project_private") {
    return resolve(projectRoot, ".mewcode", "MEWCODE.md");
  }
  return resolve(projectRoot, "MEWCODE.md");
}
