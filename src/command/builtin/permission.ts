import type { CommandDef, UIContext } from "../types.js";

// permissionInfo —— 由外层注入
let getPermissionInfo: (() => string) | null = null;

export function setPermissionInfoProvider(provider: () => string): void {
  getPermissionInfo = provider;
}

function handlePermission(_args: string, ui: UIContext): void {
  const info = getPermissionInfo?.() ?? "权限信息不可用";
  ui.showMessage(info, "info");
}

export const permissionCommand: CommandDef = {
  name: "permission",
  aliases: [],
  description: "查看当前权限模式",
  usage: "/permission",
  type: "local",
  handler: handlePermission,
};
