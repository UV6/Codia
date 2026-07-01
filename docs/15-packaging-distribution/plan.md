# Packaging Distribution - 技术方案

## 总体方案

把发布链路拆成五个 Module：

1. **源码入口 Module。** 保留 `bin/codia.tsx`，用于开发和编译输入。
2. **构建 Module。** 用 TypeScript 将 `bin` 和 `src` 编译到 `dist`。
3. **包清单 Module。** 用 `package.json` 定义 npm 安装时暴露哪些文件和命令。
4. **发布检查 Module。** 用脚本和手动烟测验证包能在干净目录运行。
5. **用户文档 Module。** 用 README 说明安装、配置、使用和排错。

这个拆分的目标是让调用者只需要记住小接口：

- 开发：`pnpm dev`
- 验证：`pnpm test && pnpm typecheck && pnpm build`
- 打包：`pnpm pack`
- 安装后运行：`codia`

复杂性留在构建配置、包清单和文档里。

## 当前问题

### 问题 1: 发布入口依赖 TS 运行器

当前入口：

```json
{
  "bin": {
    "codia": "./bin/codia.tsx"
  }
}
```

当前 shebang：

```typescript
#!/usr/bin/env tsx
```

这适合本地开发，不适合 npm 发布。全局安装后，用户运行的是 npm 创建的命令链接。该链接会执行 `bin/codia.tsx`，但用户环境通常没有全局 `tsx`。

### 问题 2: 没有发布构建脚本

`tsconfig.json` 已经有 `outDir: "dist"`，但 `package.json` 没有 `build` 脚本。即使手动运行 `tsc`，当前 include 会覆盖 `src/**/*`，测试文件也会进入构建输入，不适合发布。

### 问题 3: 发布内容没有收口

缺少 `files` 字段时，npm 会根据默认规则打包大量仓库内容。对于 CLI 产品，发布包应尽量小，只包含运行产物和必要文档。

### 问题 4: 缺少安装后验证

源码测试通过不代表发布包能运行。发布问题常见于：

- `bin` 指向错误
- shebang 错误
- 产物未被打进包
- 运行依赖误放到 `devDependencies`
- 编译后的相对 import 路径错误
- 运行时读取了仓库内才存在的文件

## 推荐目录和文件改动

### 1. 新增 `tsconfig.build.json`

建议内容：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*", "bin/**/*"],
  "exclude": [
    "node_modules",
    "dist",
    "src/__tests__/**/*",
    "vitest.config.ts"
  ]
}
```

说明：

- `rootDir` 继续继承为 `.`
- 编译后入口会落在 `dist/bin/codia.js`
- `src` 会落在 `dist/src`
- `bin/codia.tsx` 中的 `../src/...` 编译后仍能指向 `dist/src/...`

### 2. 新增发布构建脚本

建议新增 `scripts/build-package.mjs`，职责固定为：

- 清理旧的 `dist`
- 执行 `tsc -p tsconfig.build.json`
- 复制运行时资源到 `dist`

推荐脚本接口：

```javascript
export function cleanDist(projectRoot) {}
export function copyRuntimeAssets(projectRoot) {}
export function buildPackage(projectRoot) {}
```

当前必须复制的运行时资源：

- `src/skill/builtin/*.md` -> `dist/src/skill/builtin/*.md`

原因：

- [src/skill/loader.ts](/Users/liuwei/Code/Codia/src/skill/loader.ts:11) 运行时按 `__dirname/builtin` 读取内置 Skill
- 编译后 `__dirname` 会落到 `dist/src/skill`
- 单纯 `tsc` 不会复制 Markdown 文件

### 3. 修改 CLI shebang

把 `bin/codia.tsx` 第一行改为：

```typescript
#!/usr/bin/env node
```

原因：

- 源文件由 `tsx bin/codia.tsx` 启动时，shebang 不影响开发
- 编译产物由 Node 直接执行时，需要 Node shebang
- TypeScript 会保留 hashbang 到输出文件

### 4. 修改 `package.json`

建议新增或修改：

```json
{
  "bin": {
    "codia": "./dist/bin/codia.js"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "dev": "tsx bin/codia.tsx",
    "build": "node ./scripts/build-package.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "prepack": "pnpm typecheck && pnpm test && pnpm build"
  },
  "engines": {
    "node": ">=20"
  }
}
```

`engines.node` 的具体版本需要结合项目实际运行能力确认。当前代码使用 Node 内置 `fetch`、ESM、`node:util.parseArgs`、Ink 5，建议从 Node 20 起步，降低用户环境差异。

### 5. 依赖分类检查

原则：

- 运行时 import 的包必须在 `dependencies`
- 仅测试、编译、开发用的包放在 `devDependencies`

当前运行依赖看起来应保留在 `dependencies`：

- `highlight.js`
- `ink`
- `ink-text-input`
- `marked`
- `minimatch`
- `react`
- `yaml`

当前开发依赖可以继续放在 `devDependencies`：

- `tsx`
- `typescript`
- `vitest`
- `@types/*`

### 6. README 最小结构

README 至少包含：

```markdown
# Codia

## 要求

- Node.js >= 20
- pnpm/npm
- git

## 安装

npm install -g codia

## 配置

创建 ~/.codia/Codia.yml

## 使用

codia
codia --help
codia --sessions

## 数据目录

说明 ~/.codia 和 <project>/.codia

## 常见问题
```

### 7. 本地 pack 烟测

发布前使用临时目录验证：

```bash
pnpm pack
mkdir -p /tmp/codia-pack-test
cd /tmp/codia-pack-test
npm install -g /path/to/codia-0.1.0.tgz
codia --help
codia --sessions
```

更严格的做法是不要全局安装，而是用临时 npm prefix：

```bash
PREFIX="$(mktemp -d)"
CODIA_HOME="$(mktemp -d)"
TARBALL="/path/to/codia-x.y.z.tgz"
npm install --prefix "$PREFIX" "$TARBALL"
CODIA_HOME="$CODIA_HOME" "$PREFIX/node_modules/.bin/codia" --help
```

这样不会污染用户全局环境。

## 推荐实施顺序

1. 新增 `tsconfig.build.json`
2. 新增发布构建脚本并接入资源复制
3. 修改 shebang 为 Node
4. 修改 `package.json` 的 `bin`、`scripts`、`files`、`engines`
5. 执行 `pnpm build`
6. 检查 `dist/bin/codia.js` 和 `dist/src/skill/builtin/*.md`
7. 执行 `pnpm pack --dry-run`
8. 执行本地安装烟测
9. 补 README
10. 补 CI

## 风险和处理

### 风险 1: 编译后 JSX 或 ESM import 出错

处理方式：

- 保持 `module` 和 `moduleResolution` 为 `NodeNext`
- 保持源代码 import 使用 `.js` 后缀
- 用 `node dist/bin/codia.js --help` 验证

### 风险 2: 运行依赖漏放到 `dependencies`

处理方式：

- 在干净目录安装 pack 产物
- 不依赖当前仓库的 `node_modules`
- 运行 `codia --help` 和 `codia --sessions`

### 风险 3: 发布包漏掉内置资源

目前内置 Skill 在 `src/skill/builtin/*.md`，运行时会从编译后的 `dist/src/skill/builtin` 读取。

这里不能只改 `files`，必须在构建步骤里复制资源到 `dist`。

这是发布打包最需要重点验证的资源类风险。

### 风险 4: 用户已有 `~/.Codia` 旧目录

路径统一后，新版本读取 `~/.codia`。如果曾经存在旧用户，可能需要迁移说明或启动兼容逻辑。

本发布方案建议先在 README 明确迁移命令，后续再做自动迁移：

```bash
mkdir -p ~/.codia
cp -R ~/.Codia/* ~/.codia/
```

## 后续增强

- 增加 `codia doctor`：检查 Node 版本、配置文件、API key、git、可写目录
- 增加 `codia init`：生成示例配置
- 增加 GitHub Actions：PR 执行 test/typecheck/build，tag 执行 publish
- 增加 npm provenance：提高供应链可信度
- 增加 changelog 和 release notes
