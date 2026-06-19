# Agent 系统 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] AgentRoleFrontmatter/AgentRole 类型已定义（验证：`pnpm typecheck` 通过）
- [ ] 四个内置角色已定义，含中文 body（验证：`pnpm typecheck` 通过）
- [ ] 角色加载器支持扫描 .md 文件并解析 frontmatter（验证：`pnpm test` 通过）
- [ ] 角色注册中心支持四级优先级合并和同名覆盖（验证：`pnpm test` 通过）
- [ ] SubAgentConfig/SubAgentResult/BackgroundTask 类型已定义（验证：`pnpm typecheck` 通过）
- [ ] 工具过滤管线四层过滤正确（验证：`pnpm test` 通过）
- [ ] TaskManager 创建/更新/列表/查询/cancelAll 功能可用（验证：`pnpm test` 通过）
- [ ] TaskList/TaskGet/TaskCreate/TaskUpdate 四个工具已注册（验证：`pnpm test` 通过）
- [ ] SubAgentRunner 定义式和 Fork 式消息构造正确（验证：`pnpm test` 通过）
- [ ] Agent 工具有效注册且参数 schema 完整（验证：`pnpm test` 通过）
- [ ] ChatService 已注入 Agent 工具和任务管理工具（验证：`pnpm typecheck` 通过）

## 集成

- [ ] Agent 工具正确调用 AgentRoleRegistry.resolve()（验证：集成测试通过）
- [ ] 子 Agent 工具过滤结果正确传给 AgentLoop（验证：集成测试通过）
- [ ] TaskManager.onComplete 回调成功注入通知到 messages（验证：集成测试通过）
- [ ] 所有公开接口至少被一个真实调用方使用（验证：编译 + 全部测试通过）

## 验收标准

- [ ] AC1: 角色文件加载功能已验证（验证：端到端场景 1 中 Agent 角色列表可见）
- [ ] AC2: 优先级覆盖逻辑已验证（验证：端到端场景 5）
- [ ] AC3: 主 Agent 调用 Agent 工具，subagent_type 指定 Explore，子 Agent 启动并返回结果（验证：端到端场景 1）
- [ ] AC4: 主 Agent 调用 Agent 工具，subagent_type 留空，继承对话历史，首次请求命中缓存（验证：端到端场景 2）
- [ ] AC5: 定义式子 Agent 看不到主对话历史，只看到自己的系统提示和 prompt（验证：端到端场景 1）
- [ ] AC6: Fork 式子 Agent 自动后台执行（验证：端到端场景 2）
- [ ] AC7: 权限状态隔离已验证（验证：端到端场景 4 中并发子 Agent 互不干扰）
- [ ] AC8: 子 Agent 模型返回纯文本后自动结束（验证：端到端场景 1）
- [ ] AC9: 子 Agent 达到最大轮次上限时截断（验证：端到端场景 3）
- [ ] AC10: 全局禁止工具列表包含 Agent（验证：端到端场景 6）
- [ ] AC11: 自定义额外禁用列表功能已验证（验证：端到端场景 7）
- [ ] AC12: 后台子 Agent 完成后主对话出现 <task-notification>（验证：端到端场景 4）
- [ ] AC13: TaskList 工具可查询后台任务列表（验证：端到端场景 4）

## 编译与测试

- [ ] 项目编译无错误（验证：`pnpm typecheck` 通过）
- [ ] 所有单元测试通过（验证：`pnpm test` 全部通过）

## 端到端场景

- [ ] 场景 1：主 Agent 调 Agent(subagent_type="Explore", prompt="在 src/agent 目录下找所有导出的类") → 子 Agent 以空白上下文启动，搜索文件系统，返回类列表文本，自动结束
- [ ] 场景 2：主 Agent 调 Agent(subagent_type="", prompt="基于刚才的搜索结果，写一个使用文档") → Fork 式继承对话历史，后台执行，完成后注入 <task-notification> 到主对话
- [ ] 场景 3：子 Agent 被限制 maxRounds=1，在第一轮后模型仍有工具调用 → 返回"已达最大轮次"提示而非卡住
- [ ] 场景 4：两个子 Agent 并发后台执行，通过 TaskList 看到两个 running 任务 → 各自完成后状态变为 completed，<task-notification> 逐一注入主对话
- [ ] 场景 5：在 $PROJECT/.codia/agents/ 下创建同名角色覆盖用户级角色，验证最终生效的是项目级版本
- [ ] 场景 6：在子 Agent 中调用 Agent 工具尝试创建孙 Agent，验证被全局禁止层拒绝
- [ ] 场景 7：在 CUSTOM_AGENT_DISALLOWED_TOOLS 中配置 Grep，验证所有子 Agent 均不可见 Grep 工具
