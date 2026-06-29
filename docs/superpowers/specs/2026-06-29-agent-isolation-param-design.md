# Agent isolation 参数化

## 目标

让 `Agent` 工具的 `isolation` 参数真正生效，调用时可通过布尔参数指定是否启用 worktree 隔离。

## 背景

- `AgentRoleFrontmatter` 已有 `isolation?: "worktree"`，角色级别隔离已可用
- `AgentTool.inputSchema` 有 `isolation` 参数但标记为"预留"，`execute()` 中未读取使用
- `SubAgentRunner.run()` 只检查 `config.role?.frontmatter.isolation`，无法从调用参数覆盖
- `SubAgentConfig` 没有 `isolation` 字段

## 优先级

`params.isolation ?? (role.frontmatter.isolation === "worktree") ?? false`

- 工具调用参数显式指定 > 角色配置默认行为 > 不做隔离

## 数据流

```
Agent 工具调用 (params.isolation: boolean | undefined)
    │
    ▼
AgentTool.execute()
    │ resolve: params.isolation ?? (role.frontmatter.isolation === "worktree") ?? false
    │
    ▼
SubAgentConfig.isolation: boolean
    │
    ▼
SubAgentRunner.run()
    │ config.isolation → 创建 worktree
    │ !config.isolation → 直接在原始 cwd 执行
```

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/agent/types.ts` | `SubAgentConfig` 加 `isolation: boolean` |
| `src/agent/agent-tool.ts` | `inputSchema` 中 `isolation` 改为 `boolean`；`execute()` 中读取参数并 resolve 写入 config |
| `src/agent/sub-agent-runner.ts` | `run()` 中用 `config.isolation` 替换 `config.role?.frontmatter.isolation` |

`src/agent/role/types.ts` 无改动（角色 frontmatter 保持 `isolation?: "worktree"`）。

## 关键行为

- **定义式 Agent**：角色配置了 `isolation: "worktree"` 默认启用，调用传 `isolation: false` 可覆盖关闭
- **Fork 式 Agent**：无角色配置，默认不隔离，调用传 `isolation: true` 可显式开启
- **Runner**：不再关心隔离决策来源，只看 `config.isolation`

## 测试

单元测试覆盖：
1. 定义式 Agent，角色 `isolation: "worktree"`，不传参数 → worktree 创建
2. 定义式 Agent，角色 `isolation: "worktree"`，传 `isolation: false` → 不创建
3. 定义式 Agent，角色无 isolation，传 `isolation: true` → worktree 创建
4. Fork 式 Agent，不传参数 → 不创建 worktree
5. Fork 式 Agent，传 `isolation: true` → worktree 创建
