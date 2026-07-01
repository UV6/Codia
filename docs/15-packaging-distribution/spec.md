# Packaging Distribution - 安装发布 Spec

## 背景

Codia 当前是一个本地开发形态的 TypeScript CLI 项目。它已经具备 CLI 入口、TUI、Agent 循环、工具系统、权限系统、MCP、Skill、记忆和 worktree 等核心能力，但还不能稳定作为 npm 包安装到其他电脑后直接运行。

当前关键现状：

- `package.json` 的 `bin.codia` 指向 `./bin/codia.tsx`
- `bin/codia.tsx` 使用 `#!/usr/bin/env tsx`
- `tsx` 位于 `devDependencies`
- `package.json` 没有 `build`、`prepack`、`files`、`engines` 等发布相关配置
- `tsconfig.json` 已设置 `outDir: "dist"`，但当前构建会包含 `src/__tests__`，不适合作为发布构建
- README 基本为空，外部用户缺少安装、配置和排错说明
- 运行时内置 Skill 依赖 `src/skill/builtin/*.md` 文件，发布构建必须显式复制到 `dist`

这意味着用户通过 `npm install -g codia` 或 `pnpm add -g codia` 安装后，`codia` 命令大概率无法运行。原因是全局安装不会安装项目的 `devDependencies`，而入口文件又依赖 `tsx` 解释 TypeScript 源码。

## 目标

将 Codia 从“源码开发项目”推进到“可打包、可安装、可运行、可验证”的 CLI 产品形态。

核心目标：

- 用户在另一台电脑上安装 npm 包后，可以直接执行 `codia --help`
- 发布包只包含运行需要的文件，不包含测试、文档草稿、源码开发杂物
- CLI 入口运行编译后的 JavaScript，不依赖用户机器安装 `tsx`
- 发布前自动执行类型检查、测试和构建
- 提供首次使用说明，包括配置文件路径、示例配置、常见错误和数据目录
- 提供可重复的本地打包验收流程，能在发布前发现安装问题

## 非目标

本阶段不做以下事项：

- 不实现自动发布到 npm 的完整 CI 流水线
- 不实现跨平台安装器，如 Homebrew、Scoop、Winget
- 不做单文件二进制打包，如 pkg、nexe、Bun compile
- 不重构 CLI、TUI、Agent 的业务逻辑
- 不改变模型协议和配置字段语义

## 用户故事

- 作为普通用户，我可以通过包管理器安装 Codia，并运行 `codia --help` 看到帮助信息。
- 作为首次使用者，我可以根据 README 创建 `~/.codia/Codia.yml`，然后启动 Codia。
- 作为维护者，我可以执行一条命令完成发布前检查，确认测试、类型检查、构建和打包烟测通过。
- 作为贡献者，我可以从文档知道源代码入口、发布产物入口、配置目录和运行目录的关系。

## 功能需求

### F1: 编译后运行

发布包中的 `codia` 命令必须指向编译后的 JavaScript 文件，例如 `dist/bin/codia.js`。

源文件 `bin/codia.tsx` 可以继续作为开发入口，但发布入口不能依赖 `tsx`。

### F2: 独立发布构建

需要新增发布专用 TypeScript 配置，例如 `tsconfig.build.json`。

发布构建应包含：

- `bin/**/*`
- `src/**/*`

发布构建应排除：

- `src/__tests__/**/*`
- `dist`
- `node_modules`
- 测试配置和测试辅助文件

发布构建还必须：

- 在编译前清理旧的 `dist`
- 在编译后复制运行时资源到 `dist`

当前必须复制的资源：

- `src/skill/builtin/*.md` -> `dist/src/skill/builtin/*.md`

### F3: npm 包元数据

`package.json` 需要补齐发布所需字段：

- `bin`
- `files`
- `scripts.build`
- `scripts.prepack`
- `engines.node`
- `repository`
- `bugs`
- `homepage`
- `author`

其中 `files` 应限制发布内容，避免把本地配置、测试、历史文档或开发缓存打进 npm 包。

### F4: 发布前检查

发布前至少执行：

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm pack`
- 在临时目录安装 pack 产物并运行 `codia --help`

### F5: 首次使用文档

README 需要包含：

- 安装方式
- Node.js 版本要求
- 配置文件路径：`~/.codia/Codia.yml`
- Anthropic 和 OpenAI 配置示例
- 常用命令
- 数据落盘位置
- 常见错误排查

### F6: 运行时路径说明

用户文档必须明确：

- 用户级配置：`~/.codia/Codia.yml`
- 用户级数据根目录：`~/.codia`
- `CODIA_HOME` 可覆盖默认用户目录
- 项目级 MCP 配置：`<project>/.codia/config.yml`
- 项目级规则：`<project>/.codia/permissions.yaml`
- 本地个人规则：`<project>/.codia/permissions.local.yaml`

并明确区分：

- 主启动配置只从用户级 `Codia.yml` 读取
- 项目级 `.codia/config.yml` 不替代主配置文件

### F7: 本地安装烟测

需要提供可重复的手动验收流程，验证另一个目录中安装后的 CLI 行为。

烟测应使用临时 `CODIA_HOME`，不能依赖或污染真实 `~/.codia`。

最小烟测：

- `codia --help` 正常输出
- `codia --sessions` 在无历史会话时正常输出
- 缺少配置文件时给出可读错误
- 配置文件存在但 key 错误时能进入启动并在请求时返回可读错误

## 非功能需求

- **N1: 可移植性。** 发布包不能依赖仓库绝对路径。
- **N2: 最小发布面。** npm 包只包含运行所需产物和用户文档。
- **N3: 可诊断性。** 启动失败时错误信息必须指向具体配置路径或依赖缺失原因。
- **N4: 可重复性。** 同一 commit 多次构建应产生同样结构的发布产物。
- **N5: 向后兼容。** 已统一到 `~/.codia` 的路径语义不能被发布改造破坏。

## 设计约束

- 当前项目使用 ESM：`"type": "module"`
- TypeScript 编译模式使用 `NodeNext`
- CLI 使用 Ink 和 React，需要保留 JSX 编译能力
- 发布入口应使用 Node 执行：`#!/usr/bin/env node`
- 开发入口可以继续使用 `pnpm dev` 和 `tsx`

## 验收标准

- **AC1:** 执行 `pnpm build` 后生成 `dist/bin/codia.js`
- **AC2:** `dist/bin/codia.js` 第一行是 Node shebang，且可被直接执行
- **AC3:** `package.json` 的 `bin.codia` 指向 `dist/bin/codia.js`
- **AC4:** `pnpm pack --dry-run` 的文件列表不包含 `src/__tests__`
- **AC4a:** `pnpm pack --dry-run` 的文件列表包含 `dist/src/skill/builtin/*.md`
- **AC5:** 在临时目录安装 pack 产物后，`codia --help` 返回 0
- **AC6:** 在临时目录安装 pack 产物后，`codia --sessions` 返回 0
- **AC7:** 在临时 `CODIA_HOME` 下缺失 `Codia.yml` 时，启动错误提示包含配置路径
- **AC8:** `pnpm test` 和 `pnpm typecheck` 通过
- **AC9:** README 足够让新用户完成安装和首次配置
