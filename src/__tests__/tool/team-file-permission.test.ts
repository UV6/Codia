import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import { buildCodiaFilePermissionRequest } from "../../tool/team-file-permission.js";
import { getProjectRuntimeRoot } from "../../storage/paths.js";

describe("buildCodiaFilePermissionRequest", () => {
  const cwd = "/mock/project";
  const teamsRoot = join(homedir(), ".codia", "teams");

  it("team 目录下的绝对路径返回额外白名单", () => {
    const teamFile = join(teamsRoot, "alpha", "group.json");
    const result = buildCodiaFilePermissionRequest(teamFile, cwd);

    expect(result.targetPaths).toEqual([teamFile]);
    expect(result.extraAllowedRoots).toEqual([teamsRoot]);
  });

  it("当前项目 runtime 目录下的路径返回额外白名单", () => {
    const runtimeRoot = getProjectRuntimeRoot(cwd);
    const file = join(runtimeRoot, "sessions", "a.jsonl");
    const result = buildCodiaFilePermissionRequest(file, cwd);

    expect(result.targetPaths).toEqual([file]);
    expect(result.extraAllowedRoots).toEqual([runtimeRoot]);
  });

  it("非 team 目录路径不返回白名单", () => {
    const otherFile = join(homedir(), ".codia", "memory", "index.json");
    const result = buildCodiaFilePermissionRequest(otherFile, cwd);

    expect(result).toEqual({});
  });

  it("空路径返回空结果", () => {
    expect(buildCodiaFilePermissionRequest(undefined, cwd)).toEqual({});
  });
});
