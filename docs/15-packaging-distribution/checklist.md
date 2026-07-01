# Packaging Distribution - 验收清单

## 自动验证

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过
- [ ] `pnpm build` 通过
- [ ] `dist/bin/codia.js` 存在
- [ ] `dist/bin/codia.js` 第一行为 `#!/usr/bin/env node`
- [ ] `node dist/bin/codia.js --help` 返回 0
- [ ] `node dist/bin/codia.js --sessions` 返回 0
- [ ] `pnpm pack --dry-run` 不包含 `src/__tests__`
- [ ] `pnpm pack --dry-run` 包含运行所需资源文件
- [ ] `dist/src/skill/builtin/*.md` 已生成

## 本地安装烟测

- [ ] 生成包：`pnpm pack`
- [ ] 使用临时 prefix 安装 `.tgz`
- [ ] 使用临时 `CODIA_HOME` 执行安装后的 `codia --help`
- [ ] 使用临时 `CODIA_HOME` 执行安装后的 `codia --sessions`
- [ ] 在临时 `CODIA_HOME` 下无 `Codia.yml` 时执行 `codia`，错误提示包含配置路径
- [ ] 写入最小配置后执行 `codia`，能进入 TUI 或返回可理解的网络/API 错误

## 包内容检查

- [ ] 包内包含 `dist/bin/codia.js`
- [ ] 包内包含 `dist/src/**/*`
- [ ] 包内包含 `dist/src/skill/builtin/*.md`
- [ ] 包内包含 README
- [ ] 包内包含 LICENSE
- [ ] 包内不包含 `.codia/permissions.local.yaml`
- [ ] 包内不包含 `node_modules`
- [ ] 包内不包含 `src/__tests__`
- [ ] 包内不包含 `.codegraph`
- [ ] 包内不包含 `.git`

## 用户文档检查

- [ ] README 说明 Node.js 版本要求
- [ ] README 说明安装命令
- [ ] README 说明配置文件路径
- [ ] README 说明 `CODIA_HOME` 用法
- [ ] README 提供 Anthropic 示例配置
- [ ] README 提供 OpenAI 示例配置
- [ ] README 说明常用 CLI 参数
- [ ] README 说明运行时数据目录
- [ ] README 说明项目级 `.codia/config.yml` 只用于 MCP
- [ ] README 说明 `~/.Codia` 到 `~/.codia` 的迁移
- [ ] README 说明常见错误排查

## 手动终端测试清单

这些场景需要你在本地终端手动跑：

- [ ] 场景 1：干净临时目录安装 pack 产物后执行 `codia --help`
- [ ] 场景 2：干净临时目录安装 pack 产物后执行 `codia --sessions`
- [ ] 场景 3：设置临时 `CODIA_HOME` 且不创建 `Codia.yml`，执行 `codia`，确认错误提示清晰
- [ ] 场景 4：写入错误 API key 后启动并发送消息，确认认证错误可读
- [ ] 场景 5：项目目录存在 `.codia/config.yml` 时，MCP 配置仍能加载
- [ ] 场景 6：执行 `/skills` 或技能相关命令，确认内置 Skill 没有因打包丢失
- [ ] 场景 7：在没有当前源码仓库的目录中运行安装后的 `codia`，确认不会访问仓库绝对路径

## 发布前最终检查

- [ ] 当前分支干净或只包含预期改动
- [ ] 版本号已更新
- [ ] CHANGELOG 或 release notes 已准备
- [ ] `npm whoami` 显示正确发布账号
- [ ] `npm publish --dry-run` 输出符合预期
- [ ] 发布后新开终端安装并执行 `codia --help`
