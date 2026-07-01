# Codia

终端 AI 编程助手，面向本地代码库协作，使用 TypeScript 和 Ink 构建。

## 环境要求

- Node.js >= 20
- `pnpm` 或 `npm`
- `git`

## 安装

```bash
npm install -g codia
```

开发模式仍使用仓库内脚本：

```bash
pnpm dev
```

## 配置

首次启动前需要创建用户级配置文件：

路径：`~/.codia/Codia.yml`

Anthropic 示例：

```yaml
protocol: anthropic
model: claude-sonnet-4-20250514
base_url: https://api.anthropic.com
api_key: YOUR_ANTHROPIC_API_KEY
```

OpenAI 示例：

```yaml
protocol: openai
model: gpt-5
base_url: https://api.openai.com
api_key: YOUR_OPENAI_API_KEY
```

补充说明：

- 主启动配置只读取 `~/.codia/Codia.yml`
- `<project>/.codia/config.yml` 当前用于项目级 MCP Server 配置，不替代主配置文件
- 可以通过 `CODIA_HOME=/path/to/home` 覆盖默认用户目录，便于测试或隔离环境

如果首次启动时没有检测到 `Codia.yml`，Codia 会自动进入交互式初始化流程，引导你选择：

- `OpenAI`
- `Anthropic`
- `DeepSeek (OpenAI 兼容)`

并自动推荐默认模型和 `base_url`，你可以直接回车接受或手动修改。

## 使用

```bash
codia
codia --help
codia --sessions
codia --session <id>
```

常用参数：

- `--help`：显示帮助
- `--sessions`：列出历史会话
- `--session <id>`：恢复指定会话
- `--bypassPermissions`：启动时进入 bypassPermissions 模式

## 数据目录

默认用户数据根目录：`~/.codia`

常见路径：

- `~/.codia/Codia.yml`：主配置
- `~/.codia/projects/<project-id>/sessions/`：会话历史
- `~/.codia/projects/<project-id>/memory/`：项目记忆
- `~/.codia/memory/`：用户级记忆
- `~/.codia/teams/`：多 Agent 小组数据
- `<project>/.codia/config.yml`：项目级 MCP 配置
- `<project>/.codia/permissions.yaml`：项目共享权限规则
- `<project>/.codia/permissions.local.yaml`：本地个人权限规则

## 打包与发布

发布前建议执行：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm pack --dry-run
```

`pnpm build` 会：

- 清理旧的 `dist`
- 编译 `bin` 和 `src`
- 复制运行时需要的内置 Skill 资源到 `dist`

## 常见问题

缺少配置文件：

- 现象：启动时报 `未找到 ~/.codia/Codia.yml`
- 处理：创建该文件并填写模型、地址和 API key

认证失败：

- 现象：发送消息后返回认证错误
- 处理：检查 `api_key` 是否正确，确认 `protocol` 与 `base_url` 匹配

项目级 `.codia/config.yml` 不生效：

- 现象：已经写了项目配置，但启动仍报缺配置
- 原因：它不是主配置文件，只用于 MCP 配置合并
- 处理：把主模型配置放回 `~/.codia/Codia.yml`

从旧目录迁移：

- 如果历史数据还在 `~/.Codia`，请迁移到 `~/.codia`

```bash
mkdir -p ~/.codia
cp -R ~/.Codia/* ~/.codia/
```
