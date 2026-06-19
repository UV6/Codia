# Agent 系统 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/agent/role/types.ts` | AgentRoleFrontmatter、AgentRole 类型定义 |
| 新建 | `src/agent/role/builtin.ts` | 四个内置角色定义（Explore/Plan/general-purpose/Verification） |
| 新建 | `src/agent/role/loader.ts` | 目录扫描、frontmatter 解析、Markdown 文件加载 |
| 新建 | `src/agent/role/registry.ts` | AgentRoleRegistry，四级优先级合并 |
| 新建 | `src/agent/tool-filter.ts` | ToolFilterPipeline，四层过滤管线 |
| 新建 | `src/agent/task-manager.ts` | TaskManager，后台任务追踪与通知 |
| 新建 | `src/agent/task-tools.ts` | TaskList/TaskGet/TaskCreate/TaskUpdate 四个工具 |
| 新建 | `src/agent/sub-agent-runner.ts` | SubAgentRunner，隔离环境构造与执行 |
| 新建 | `src/agent/agent-tool.ts` | Agent 工具 Tool 实现，定义式/Fork 式分流 |
| 修改 | `src/agent/types.ts` | 新增 SubAgentConfig、SubAgentResult、BackgroundTask 类型 |
| 修改 | `src/chat/chat-service.ts` | 注入 Agent 工具、任务管理工具、TaskManager |
| 新建 | `src/__tests__/agent/role/loader.test.ts` | 角色加载器测试 |
| 新建 | `src/__tests__/agent/role/registry.test.ts` | 角色注册中心测试 |
| 新建 | `src/__tests__/agent/tool-filter.test.ts` | 工具过滤管线测试 |
| 新建 | `src/__tests__/agent/task-manager.test.ts` | 后台任务管理器测试 |
| 新建 | `src/__tests__/agent/sub-agent-runner.test.ts` | 子 Agent 运行器测试 |
| 新建 | `src/__tests__/agent/agent-tool.test.ts` | Agent 工具测试 |

---

## T1: Agent 角色类型定义

**文件：** `src/agent/role/types.ts`
**依赖：** 无
**步骤：**
1. 定义 `AgentRoleFrontmatter` 接口，含 name/description/model/maxRounds/permissionMode/tools/disallowedTools
2. 定义 `AgentRole` 接口，含 source/frontmatter/body/filePath

**验证：** `pnpm typecheck` 通过

## T2: 内置角色定义

**文件：** `src/agent/role/builtin.ts`
**依赖：** T1
**步骤：**
1. 定义四个 `AgentRole` 对象：Explore、Plan、general-purpose、Verification
2. 每个角色含 name、description（中文）、body（系统提示正文）、source: "builtin"
3. 角色内容聚焦其职责：Explore 只读搜索、Plan 架构设计、general-purpose 通用、Verification 验证

**验证：** `pnpm typecheck` 通过

## T3: 角色文件加载器

**文件：** `src/agent/role/loader.ts`
**依赖：** T1
**步骤：**
1. 实现 `loadFromDir(dir: string, source: "user" | "project" | "plugin"): AgentRole[]` 函数
2. 扫描指定目录下的所有 `.md` 文件
3. 解析每个文件的 YAML frontmatter（用 `yaml` 库分割 `---` 分隔符）
4. 校验必填字段 `name` 和 `description`，缺失则跳过并输出 warn
5. 返回通过校验的角色列表

**验证：** `pnpm typecheck` 通过

## T4: 角色注册中心

**文件：** `src/agent/role/registry.ts`
**依赖：** T1, T2, T3
**步骤：**
1. 实现 `AgentRoleRegistry` 类
2. `reload()`: 按内置→插件→用户→项目顺序加载，同名角色后者覆盖前者，存入内部 Map
3. `resolve(name)`: 按名查找，返回合并后的最终角色
4. `list()`: 返回所有角色数组
5. `getBuiltinRoles()`: 返回内置角色数组

**验证：** `pnpm typecheck` 通过

## T5: Agent 系统类型扩展

**文件：** `src/agent/types.ts`
**依赖：** T1
**步骤：**
1. 新增 `SubAgentConfig` 接口，含 type/role/prompt/description/name/model/runInBackground/parentMessages/parentProvider/parentRegistry/parentHookEngine/cwd/signal 字段
2. 新增 `SubAgentResult` 接口，含 status/text/usage/rounds/toolCalls 字段
3. 新增 `BackgroundTask` 接口，含 id/status/type/description/startTime/result 字段

**验证：** `pnpm typecheck` 通过

## T6: 工具过滤管线

**文件：** `src/agent/tool-filter.ts`
**依赖：** T1, T5
**步骤：**
1. 定义 `GLOBAL_BLOCKED_TOOLS = Set(["Agent", "AskUserQuestion", "TaskStop"])`
2. 定义 `ASYNC_AGENT_ALLOWED_TOOLS` 硬编码列表，排除 Agent、Task*、SendMessage
3. 实现 `Layer1GlobalBlock(allTools)`: 剔除全局禁止工具
4. 实现 `Layer2CustomDisallow(tools, customDisallowed)`: 按自定义列表剔除
5. 实现 `Layer3BackgroundAllow(tools, runInBackground)`: 后台模式下按白名单过滤
6. 实现 `Layer4RoleFilter(tools, role, type)`: 定义式按角色的 tools/disallowedTools 过滤
7. 实现 `ToolFilterPipeline.apply()` 串联四层，返回过滤后的 ToolMeta[]

**验证：** `pnpm typecheck` 通过

## T7: 后台任务管理器

**文件：** `src/agent/task-manager.ts`
**依赖：** T5
**步骤：**
1. 实现 `TaskManager` 类，内部用 Map<string, BackgroundTask> 存储任务
2. `create(description, type)`: 生成 taskId（`task-<timestamp>-<random>`），创建 BackgroundTask 记录，状态设为 running，返回 taskId
3. `update(taskId, result)`: 更新任务状态（completed/failed 由 result.status 决定），存储 result
4. `list()`: 返回所有 BackgroundTask 数组
5. `get(taskId)`: 按 ID 查找并返回
6. `cancelAll()`: 遍历所有 running 任务，标记为 failed，reason 为 "cancelled"
7. 触发 `onComplete` 回调（可选）

**验证：** `pnpm typecheck` 通过

## T8: 任务管理工具

**文件：** `src/agent/task-tools.ts`
**依赖：** T7
**步骤：**
1. 实现 `TaskListTool`: readOnly，execute 调用 taskManager.list()，返回 JSON 格式列表
2. 实现 `TaskGetTool`: readOnly，execute 接收 taskId 参数，调用 taskManager.get()，返回 JSON 详情
3. 实现 `TaskCreateTool`: readOnly=false，execute 接收 subject/description 参数，调用 taskManager.create()
4. 实现 `TaskUpdateTool`: readOnly=false，execute 接收 taskId/status 参数，调用 taskManager.update()
5. 导出 `createTaskTools(taskManager): Tool[]` 工厂函数

**验证：** `pnpm typecheck` 通过

## T9: 子 Agent 运行器

**文件：** `src/agent/sub-agent-runner.ts`
**依赖：** T5, T6, T7
**步骤：**
1. 实现 `SubAgentRunner` 类
2. constructor 接收 `SubAgentConfig`，存储引用
3. `run()` 方法：
   - 构造 messages（定义式从空开始，Fork 式浅拷贝 + 追加 prompt）
   - 构造 system prompt（定义式用角色 body，Fork 式复用父 Agent 的 system prompt）
   - 调用 `ToolFilterPipeline.apply()` 生成过滤后的 toolMetas
   - 创建独立的 `PermissionChecker`（按角色 permissionMode）
   - 创建独立的 `ToolRegistry` 实例 + 注册过滤后的工具
   - 创建 `AgentLoop` 实例，传入 config.parentHookEngine 保持 Hook 事件正常触发
   - 收集 text 事件拼接最终文本
   - 记录 usage、rounds、toolCalls 计数
   - 捕获异常返回 failed
4. `runInBackground()` 方法：异步启动 run()，完成后调用 taskManager.update()

**验证：** `pnpm typecheck` 通过

## T10: Agent 工具实现

**文件：** `src/agent/agent-tool.ts`
**依赖：** T4, T6, T9
**步骤：**
1. 实现 `AgentTool` 类，实现 Tool 接口
2. name = `"Agent"`, type = `"search"`, readOnly = false, destructive = false
3. inputSchema 定义参数：subagent_type(string, 可选)、description(string, 必填)、prompt(string, 必填)、name(string, 可选)、model(string, 可选)、run_in_background(boolean, 可选)、isolation(string, 可选)
4. `execute()` 方法：
   - 校验必填参数
   - 解析 subagent_type：有值则 registry.resolve(type) 加载角色，无角色则返回错误；留空则 Fork 式
   - 构造 SubAgentConfig
   - 创建 SubAgentRunner
   - 根据 run_in_background/Fork 分支执行
   - 前台：await runner.run()，返回结果文本
   - 后台：调用 runner.runInBackground()，注册到 TaskManager，返回"已加入后台"提示
5. 导出创建 Agent 工具的工厂函数 `createAgentTool(registry, taskManager, ...)`

**验证：** `pnpm typecheck` 通过

## T11: ChatService 接入

**文件：** `src/chat/chat-service.ts`
**依赖：** T4, T7, T8, T10
**步骤：**
1. 在 `ChatService` 构造函数中创建 `AgentRoleRegistry` 实例并调用 `reload()`
2. 创建 `TaskManager` 实例
3. 注册 Agent 工具到 `ToolRegistry`
4. 注册 TaskList/TaskGet/TaskCreate/TaskUpdate 四个工具到 `ToolRegistry`
5. 注册 TaskManager 的 `onComplete` 回调：将 `<task-notification>` 注入到 messages 数组
6. 将 TaskManager 注入到 Agent 工具的执行上下文中

**验证：** `pnpm typecheck` 通过

## T12: 单元测试

**文件：** `src/__tests__/agent/role/loader.test.ts`、`registry.test.ts`、`tool-filter.test.ts`、`task-manager.test.ts`、`sub-agent-runner.test.ts`、`agent-tool.test.ts`
**依赖：** T1-T11
**步骤：**
1. loader 测试：验证 frontmatter 解析、缺失必填字段跳过
2. registry 测试：验证四级优先级合并、同名覆盖
3. tool-filter 测试：验证四层过滤正确性、空输入处理
4. task-manager 测试：验证创建/更新/列表/查询/cancelAll
5. sub-agent-runner 测试：验证定义式和 Fork 式消息构造差异
6. agent-tool 测试：验证参数校验、分流逻辑、后台模式

**验证：** `pnpm test` 全部通过

---

## 执行顺序

```
T1 → T2 → T5
      ↘    ↘
       T3 → T4 → T10 → T11
                 ↗
       T6 → T9 ↗
       T7 → T8 ↗
            ↘
             T12（在所有实现完成后执行）
```

T1、T2、T5 可并行；T3 依赖 T1；T4 依赖 T1-T3；T6、T7 互相独立可并行；T8 依赖 T7；T9 依赖 T5、T6、T7；T10 依赖 T4、T6、T9；T11 依赖 T4、T7、T8、T10；T12 在所有模块完成后执行。
