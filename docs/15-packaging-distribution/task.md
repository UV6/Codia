# Packaging Distribution - 实施任务

## T1: 构建配置

- [ ] 新增 `tsconfig.build.json`
- [ ] 排除 `src/__tests__/**/*`
- [ ] 新增 `scripts/build-package.mjs`
- [ ] 在构建脚本中先清理旧的 `dist`
- [ ] 在构建脚本中复制 `src/skill/builtin/*.md` 到 `dist/src/skill/builtin`
- [ ] 确认构建产物路径为 `dist/bin/codia.js` 和 `dist/src/**/*`
- [ ] 执行 `pnpm build` 验证 TypeScript 编译通过

验证：

```bash
pnpm build
test -f dist/bin/codia.js
test -f dist/src/skill/builtin/commit.md
```

## T2: CLI 发布入口

- [ ] 将 `bin/codia.tsx` shebang 改为 `#!/usr/bin/env node`
- [ ] 将 `package.json` 的 `bin.codia` 改为 `./dist/bin/codia.js`
- [ ] 确认编译后的 `dist/bin/codia.js` 保留 shebang
- [ ] 确认 `node dist/bin/codia.js --help` 可运行

验证：

```bash
pnpm build
head -n 1 dist/bin/codia.js
node dist/bin/codia.js --help
```

## T3: package.json 发布字段

- [ ] 新增 `build` 脚本
- [ ] 新增 `prepack` 脚本
- [ ] 新增 `files` 字段
- [ ] 新增 `engines.node`
- [ ] 补齐 `repository`、`bugs`、`homepage`、`author`
- [ ] 补充 `LICENSE`
- [ ] 确认运行依赖都在 `dependencies`

建议脚本：

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "prepack": "pnpm typecheck && pnpm test && pnpm build"
  }
}
```

## T4: 资源文件处理

- [ ] 确认运行时从编译后的 `dist/src/skill/builtin` 读取内置 Skill
- [ ] 新增资源复制步骤
- [ ] 确认 pack 产物中包含内置 Skill
- [ ] 安装 pack 产物后运行 `/skills` 或相关命令验证内置 Skill 可见

验证：

```bash
pnpm pack --dry-run
```

观察文件列表是否包含内置 Skill 所需资源。

## T5: 本地打包烟测

- [ ] 执行 `pnpm pack`
- [ ] 使用临时 npm prefix 安装生成的 `.tgz`
- [ ] 执行安装后的 `codia --help`
- [ ] 执行安装后的 `codia --sessions`
- [ ] 使用临时 `CODIA_HOME` 验证缺配置错误
- [ ] 使用临时 `CODIA_HOME` 验证不会污染本机真实数据

推荐命令：

```bash
pnpm pack
PREFIX="$(mktemp -d)"
CODIA_HOME="$(mktemp -d)"
TARBALL="/path/to/codia-x.y.z.tgz"
npm install --prefix "$PREFIX" "$TARBALL"
CODIA_HOME="$CODIA_HOME" "$PREFIX/node_modules/.bin/codia" --help
CODIA_HOME="$CODIA_HOME" "$PREFIX/node_modules/.bin/codia" --sessions
```

## T6: README

- [ ] 写清安装方式
- [ ] 写清 Node.js 版本要求
- [ ] 写清 `~/.codia/Codia.yml` 示例
- [ ] 写清 `CODIA_HOME` 覆盖语义
- [ ] 写清 Anthropic 配置示例
- [ ] 写清 OpenAI 配置示例
- [ ] 写清常用命令
- [ ] 写清数据目录
- [ ] 明确区分主配置与项目级 MCP 配置
- [ ] 写清常见错误
- [ ] 写清从 `~/.Codia` 迁移到 `~/.codia` 的方式

## T7: CI

- [ ] 新增 GitHub Actions workflow
- [ ] PR 检查执行 `pnpm install --frozen-lockfile`
- [ ] PR 检查执行 `pnpm typecheck`
- [ ] PR 检查执行 `pnpm test`
- [ ] PR 检查执行 `pnpm build`
- [ ] 可选：执行 `pnpm pack --dry-run`

## T8: 发布流程文档

- [ ] 定义版本号更新规则
- [ ] 定义发布前 checklist
- [ ] 定义 npm 登录和发布命令
- [ ] 定义发布后验证命令
- [ ] 定义回滚方式

建议发布前命令：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm pack
```

建议发布命令：

```bash
npm publish
```
