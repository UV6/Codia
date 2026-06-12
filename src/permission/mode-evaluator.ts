import type { PermissionMode, ToolCategory } from "./types.js";

// MODE_BEHAVIOR —— 四档权限模式对三种工具分类的默认行为映射
const MODE_BEHAVIOR: Record<PermissionMode, Record<ToolCategory, "allow" | "deny" | "ask">> = {
  default: {
    readonly: "allow",
    edit: "ask",
    shell: "ask",
  },
  acceptsEdit: {
    readonly: "allow",
    edit: "allow",
    shell: "ask",
  },
  plan: {
    readonly: "allow",
    edit: "deny",
    shell: "deny",
  },
  bypassPermissions: {
    readonly: "allow",
    edit: "allow",
    shell: "allow",
  },
};

// toolTypeToCategory —— 将 toolType + destructive 映射到 ToolCategory
export function toolTypeToCategory(
  toolType: "file" | "shell" | "search",
  destructive: boolean,
): ToolCategory {
  if (toolType === "shell") return "shell";
  if (destructive) return "edit";
  return "readonly";
}

// evaluate —— 根据权限模式和工具分类，返回 Layer 4 默认行为
export function evaluate(
  mode: PermissionMode,
  toolType: "file" | "shell" | "search",
  destructive: boolean,
): "allow" | "deny" | "ask" {
  const category = toolTypeToCategory(toolType, destructive);
  return MODE_BEHAVIOR[mode][category];
}
