import { resolve } from "node:path";
import type { PermissionRequest } from "../permission/types.js";
import { getProjectRuntimeRoot, getTeamsRoot } from "../storage/paths.js";

function isWithinRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(root + "/");
}

export function buildCodiaFilePermissionRequest(
  filePath: string | undefined,
  cwd: string,
): Partial<PermissionRequest> {
  if (!filePath || filePath.trim() === "") {
    return {};
  }

  const absolutePath = resolve(cwd, filePath);
  const allowedRoots = [
    getTeamsRoot(),
    getProjectRuntimeRoot(cwd),
  ];

  for (const root of allowedRoots) {
    if (isWithinRoot(absolutePath, root)) {
      return {
        targetPaths: [absolutePath],
        extraAllowedRoots: [root],
      };
    }
  }

  return {};
}
