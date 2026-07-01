import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RUNTIME_ASSET_DIRS = [
  ["src/skill/builtin", "dist/src/skill/builtin"],
];

export function cleanDist(projectRoot = process.cwd()) {
  rmSync(join(projectRoot, "dist"), { recursive: true, force: true });
}

export function copyRuntimeAssets(projectRoot = process.cwd()) {
  for (const [sourceRel, targetRel] of RUNTIME_ASSET_DIRS) {
    const sourceDir = join(projectRoot, sourceRel);
    if (!existsSync(sourceDir)) {
      continue;
    }

    const targetDir = join(projectRoot, targetRel);
    mkdirSync(dirname(targetDir), { recursive: true });
    cpSync(sourceDir, targetDir, { recursive: true });
  }
}

export function buildPackage(projectRoot = process.cwd()) {
  cleanDist(projectRoot);
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  copyRuntimeAssets(projectRoot);
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  buildPackage();
}
