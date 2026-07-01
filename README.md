# Codia

终端 AI 编程助手，面向本地代码库协作，使用 TypeScript 实现，基于 Ink 构建 TUI。它的定位接近 Codex / Claude Code 一类工具：在当前仓库中对话、读写文件、执行命令、调用 MCP 工具，并通过权限系统约束风险。

## 核心能力

- 终端对话式编程：在 TUI 中直接提问、追问、查看流式回复与思考状态
- 内置工具系统：读文件、写文件、编辑文件、搜索、执行命令
- 权限模式：`default`、`acceptsEdit`、`plan`、`bypassPermissions`
- Slash 命令：`/help`、`/context`、`/session`、`/skills`、`/review`、`/team` 等
- MCP 集成：从用户级和项目级配置加载外部 MCP Server
- Skill 系统：加载内置、用户级、项目级 Skill
- 会话与恢复：JSONL 持久化，支持 `--sessions` 和 `--session <id>`
- 记忆系统：区分项目记忆和用户记忆
- 多 Agent 能力：支持 Agent 角色、任务分派、团队协作和 worktree 隔离

## 环境要求

- Node.js `>= 20`
- `npm` 或 `pnpm`
- 建议安装 `git`

## 安装

### 从 npm 安装

```bash
npm install -g codia
```

### 从本地打包产物安装

```bash
npm install -g ./codia-0.1.0.tgz
```

安装后可用命令：

```bash
codia
codia --help
codia --sessions
codia --session <id>
```

## 快速开始

首次运行：

```bash
codia
```

如果未检测到配置文件，Codia 会进入交互式初始化，当前内置 preset 为：

- `OpenAI`
- `Anthropic`

初始化完成后，会写入：

```bash
~/.codia/Codia.yml
```

如果你不想走初始化流程，也可以手动创建配置文件。

## 配置

### 主配置文件

默认路径：

```bash
~/.codia/Codia.yml
```

说明：

- 主启动配置只从 `~/.codia/Codia.yml` 读取
- 可通过环境变量 `CODIA_HOME` 覆盖默认用户目录
- 覆盖后主配置路径会变成 `$CODIA_HOME/Codia.yml`

### Anthropic 示例

```yaml
protocol: anthropic
model: claude-opus-4-6
base_url: https://api.anthropic.com
api_key: YOUR_ANTHROPIC_API_KEY
```

### OpenAI 示例

```yaml
protocol: openai
model: gpt-5.4
base_url: https://api.openai.com
api_key: YOUR_OPENAI_API_KEY
```

### OpenAI 兼容服务示例（如 DeepSeek）

```yaml
protocol: openai
model: deepseek-v4-flash
base_url: https://api.deepseek.com
api_key: YOUR_DEEPSEEK_API_KEY
```

### 可选配置段

```yaml
agent_loop:
  max_rounds: 20

memory:
  enabled: true
  model: gpt-5.4

ui:
  pet:
    enabled: false
```

## 常用命令

CLI 参数：

```bash
codia --help
codia --sessions
codia --session <id>
codia --bypassPermissions
```

主要含义：

- `--help`：显示帮助
- `--sessions`：列出历史会话
- `--session <id>`：继续指定会话
- `--bypassPermissions`：启动时进入高权限模式

常用 Slash 命令：

- `/help`：查看命令帮助
- `/context`：查看上下文状态
- `/session`：查看当前会话信息
- `/memory`：查看已提炼记忆
- `/skills`：查看可用 Skill
- `/review`：进入代码评审相关流程
- `/plan <需求>`：切到 plan 模式
- `/do`：退出 plan 模式
- `/clear`：清空当前显示消息

## 权限模式

Codia 当前有四档权限模式：

- `default`：只读工具放行，编辑和命令通常需要确认
- `acceptsEdit`：文件编辑放行，命令通常需要确认
- `plan`：只读放行，编辑和命令拒绝
- `bypassPermissions`：除黑名单外基本放行

项目中还支持三层权限规则：

- 用户级：`~/.codia/permissions.yaml`
- 项目共享：`<project>/.codia/permissions.yaml`
- 项目本地个人：`<project>/.codia/permissions.local.yaml`

## 数据目录

默认用户数据根目录：

```bash
~/.codia
```

主要路径：

- `~/.codia/Codia.yml`：主配置
- `~/.codia/projects/<project-id>/sessions/`：会话历史
- `~/.codia/projects/<project-id>/memory/`：项目记忆
- `~/.codia/projects/<project-id>/worktrees/`：隔离 worktree
- `~/.codia/memory/`：用户级记忆
- `~/.codia/teams/`：团队协作数据
- `~/.codia/agents/`：用户级 Agent 角色

项目目录下常见文件：

- `<project>/.codia/config.yml`：项目级 MCP 配置
- `<project>/.codia/permissions.yaml`：项目共享权限规则
- `<project>/.codia/permissions.local.yaml`：本地个人权限规则
- `<project>/.codia/agents/`：项目级 Agent 角色

注意：

- `<project>/.codia/config.yml` 只用于 MCP 配置加载，不替代主配置文件
- MCP 配置会按“用户级 + 项目级覆盖”合并

## 打包与发布

当前项目已经具备可安装的 npm CLI 发布形态，关键点如下：

- `bin.codia` 指向 `dist/bin/codia.js`
- 运行入口使用 `#!/usr/bin/env node`
- `pnpm build` 会编译 `bin` 和 `src` 到 `dist`
- 构建时会复制运行时资源，如 `src/skill/builtin/*.md`
- `files` 只收口发布所需内容，避免把测试和开发杂项打进包

发布前建议执行：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm pack --dry-run
```

如果要做本地安装烟测，建议使用临时目录和临时 `CODIA_HOME`：

```bash
pnpm pack
PREFIX="$(mktemp -d)"
CODIA_HOME="$(mktemp -d)"
TARBALL="$(pwd)/codia-0.1.0.tgz"
npm install --prefix "$PREFIX" "$TARBALL"
CODIA_HOME="$CODIA_HOME" "$PREFIX/node_modules/.bin/codia" --help
CODIA_HOME="$CODIA_HOME" "$PREFIX/node_modules/.bin/codia" --sessions
```

## 开发

开发模式：

```bash
pnpm dev
```

常用脚本：

```bash
pnpm test
pnpm test:watch
pnpm typecheck
pnpm build
pnpm pack --dry-run
```

项目技术栈：

- TypeScript
- Ink + React
- Vitest
- YAML 配置
- MCP / JSON-RPC

## 项目结构

高频目录：

- `bin/codia.tsx`：CLI 入口
- `src/tui`：终端 UI
- `src/chat`：会话、历史、恢复、主服务
- `src/agent`：Agent 循环、任务、子 Agent
- `src/tool`：工具系统
- `src/command`：Slash 命令
- `src/permission`：权限系统
- `src/mcp`：MCP 客户端与配置
- `src/skill`：Skill 加载与激活
- `src/memory`：记忆提炼与存储
- `src/worktree`：隔离 worktree
- `docs`：spec / plan / task / checklist 文档

## 常见问题

### 1. 提示未找到配置文件

现象：

- 启动时报 `未找到 ~/.codia/Codia.yml`

处理：

- 直接运行 `codia` 走初始化流程
- 或手动创建 `~/.codia/Codia.yml`

### 2. 能启动，但发送消息时报认证失败

优先检查：

- `api_key` 是否正确
- `protocol` 是否和 `base_url` 匹配
- 模型名是否属于当前供应商

### 3. 写了项目级 `.codia/config.yml`，但仍提示主配置缺失

原因：

- 项目级 `.codia/config.yml` 只用于 MCP
- 主模型配置仍然必须放在 `~/.codia/Codia.yml`

### 4. `--sessions` 看不到旧会话

当前会话路径已经统一到：

```bash
~/.codia/projects/<project-id>/sessions/
```

如果你的旧数据还在历史目录，先确认是否已迁移。

### 5. 旧版本使用的是 `~/.Codia`

可以手动迁移：

```bash
mkdir -p ~/.codia
cp -R ~/.Codia/* ~/.codia/
```

## 许可

[MIT](./LICENSE)
