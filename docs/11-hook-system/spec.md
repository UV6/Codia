# Hook 系统 Spec

## 背景

Codia 的 Agent 生命周期中有多处固定模式的重复工作——格式化工具结果、拦截危险操作、注入上下文信息——每次都需要人工盯或在上层硬编码。随着系统复杂度的增加（权限、压缩、记忆、Skill），这些横切关注点散落在 ChatService、AgentLoop、ToolScheduler 各处，形成隐式耦合。

当前问题：
- 工具执行前后的处理逻辑（权限检查、结果格式化）硬编码在 ToolScheduler 中，新增策略需要改源码
- 没有统一的机制在"发送消息给模型前"注入额外上下文
- 系统启动/关闭、会话创建/结束等节点无法挂载自定义行为
- 每次需要新行为都要改主流程代码，而不是声明式配置

## 目标

构建一个声明式 Hook 系统，用「事件 + 条件 + 动作」三要素描述自动化规则，让 Agent 生命周期中的重复性工作从人工编码变成配置驱动。

核心原则：
- **声明式**：规则写在 YAML 文件中，不写代码
- **非侵入**：Hook 失败只记日志，绝不中断 Agent 主流程
- **可拦截**：工具执行前的事件能阻止执行并把原因反馈给模型
- **可组合**：用简单的条件表达式精确控制触发范围

---

## 功能需求

### F1: Hook 规则加载与校验

系统从 YAML 文件加载 Hook 规则列表，在加载阶段完成所有规则的 schema 校验。校验不通过的规则被跳过并记录警告日志，不影响程序启动。

Hook 配置文件位置与现有权限规则一致，支持三层：
- 全局：`~/.codia/hooks.yaml`
- 项目：`<project>/.codia/hooks.yaml`
- 本地：`<project>/.codia/hooks.local.yaml`

每条规则包含三个核心要素：
- `event`（必填）：触发事件名称
- `if`（可选）：条件表达式，省略时表示无条件触发
- `action`（必填）：动作类型及其参数

### F2: 生命周期事件

系统定义 10 个生命周期事件，覆盖四个层级加系统级。事件分两类：

**普通事件**（触发后执行动作，不影响主流程）：

| 事件 | 层级 | 触发时机 | 上下文数据 |
|------|------|---------|-----------|
| `startup` | 系统 | 进程启动、配置加载完成后 | pid, cwd, version |
| `shutdown` | 系统 | 进程退出前 | pid, uptime |
| `session_start` | 会话 | 新会话创建时 | session_id, cwd |
| `session_end` | 会话 | 会话结束时 | session_id, message_count |
| `turn_start` | 轮次 | 每轮 Agent 迭代开始 | round, cwd, message_count |
| `turn_end` | 轮次 | 每轮 Agent 迭代结束 | round, stop_reason |
| `pre_llm` | 消息 | 消息即将发送给模型 | message_count, system_prompt |
| `post_llm` | 消息 | 模型返回完整响应后 | response, usage |
| `post_tool` | 工具 | 工具执行完成后 | tool_name, params, result, duration, cwd |

**拦截事件**（动作返回值可阻止后续执行）：

| 事件 | 层级 | 触发时机 | 上下文数据 | 拦截效果 |
|------|------|---------|-----------|---------|
| `pre_tool` | 工具 | 工具执行前，权限检查后 | tool_name, params, cwd | 拒绝时跳过工具执行，拒绝原因作为工具结果返回给模型 |

### F3: 条件表达式匹配

`if` 字段是一个结构化条件对象，用于限缩触发范围。支持两种匹配粒度：

**2.1 字段匹配**

对事件上下文中的单个字段做模式匹配，支持四种模式：

- `equals`：精确匹配（值完全相同）
- `not`：反向匹配（值不等于给定值）
- `regex`：正则表达式匹配
- `glob`：glob 通配符匹配（复用 minimatch）

```yaml
# 示例：匹配 Bash 工具中 command 参数含 git push 的调用
if:
  fields:
    - field: tool_name
      equals: Bash
    - field: "params.command"
      glob: "git push*"
```

**2.2 逻辑组合**

多个字段条件之间用 `match` 指定组合逻辑，二选一：

- `all`：全部满足才触发
- `any`：任一满足即触发

省略 `if` 字段或 `if` 为 `{}` 表示无条件触发。

### F4: Shell 命令动作

执行一条 shell 命令。动作类型标识为 `command`。

```yaml
action:
  type: command
  command: "echo 'Tool {{tool_name}} called with {{params.command}}' >> /tmp/codia.log"
```

- 命令中 `{{字段名}}` 语法引用事件上下文字段，执行前替换
- 支持嵌套字段访问，如 `{{params.command}}`

### F5: 提示词注入动作

向当前对话的消息列表注入一段提示词文本。动作类型标识为 `prompt`。

```yaml
action:
  type: prompt
  text: "注意：当前在 {{cwd}} 目录下操作，务必使用绝对路径。"
```

- `text` 字段同样支持 `{{字段名}}` 替换
- 注入时机：绑定 `pre_llm` 事件时注入到系统提示词末尾；绑定其他事件时 prompt 文本被丢弃（prompt 动作仅对 `pre_llm` 有意义）
- 注入的提示词追加到发送给模型的消息内容中

### F6: HTTP 请求动作

向指定 URL 发送 HTTP 请求。动作类型标识为 `http`。

```yaml
action:
  type: http
  url: "https://hooks.example.com/codia"
  method: POST
  headers:
    Content-Type: application/json
  body: '{"event": "{{event}}", "tool": "{{tool_name}}"}'
```

- `url`、`headers`、`body` 中的 `{{字段名}}` 在执行前替换
- `method` 为请求方法，默认 POST
- 仅支持 JSON body

### F7: 子 Agent 动作（占位）

启动一个子 Agent 执行任务。动作类型标识为 `subagent`。本阶段仅做接口预留，不实现真实 SubAgent 启动。

```yaml
action:
  type: subagent
  prompt: "Review the output of {{tool_name}}"
```

- 本阶段：规则加载时校验 schema 通过，执行时记录日志 "subagent action not implemented" 并跳过
- 后续 SubAgent 章节对接后，该动作正式启用

### F8: 执行控制

每条规则可附带可选的执行控制参数 `control`：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `run_once` | boolean | false | true 时该规则在同一会话中只执行一次 |
| `background` | boolean | false | true 时异步执行，不等待结果 |
| `timeout` | number | 30000 | 命令/HTTP 超时时间（毫秒） |

约束：
- `background: true` 不允许用于拦截事件（`pre_tool`）
- `run_once` 本阶段仅记录状态于内存，不做持久化

### F9: 拦截反馈

当 `pre_tool` 事件上的 Hook 动作为 `command` 或 `http` 时，动作的 stdout 输出作为决策信号：

- stdout 以 `REJECT:` 开头：拒绝工具执行，`REJECT:` 之后的内容作为拒绝原因
- 其他情况：放行，继续执行工具

拒绝时，系统将拒绝原因构造成一个假的工具结果返回给模型，让模型看到拒绝信息并调整后续行为：

```
[系统拦截] 工具 Bash(git push --force) 被 Hook 规则拒绝：禁止 force push 到 main 分支
```

### F10: 错误隔离

Hook 执行的任何异常（命令返回非零退出码、HTTP 超时、模板变量缺失、动作执行异常）都不中断 Agent 主流程：

- 错误信息写入日志（级别 warn）
- 如果是拦截事件且动作失败：放行工具执行（宽容策略）
- 主流程不受任何影响

## 非功能需求

- N1: Hook 调度不能显著增加事件触发点的延迟。单个事件的 Hook 总执行时间不超过 timeout 上限
- N2: 后台执行的 Hook 不阻塞主流程，失败不影响主流程
- N3: 规则配置文件的解析错误不阻止 Codia 启动，损坏的规则被跳过并记录警告

## 不做的事

- 子 Agent 动作的真实运行（等 SubAgent 章节对接）
- `run_once` 标记的持久化（当前仅内存级别）
- Hook 执行顺序的显式优先级（同一事件的多个 Hook 按配置文件顺序执行）
- 用户通过斜杠命令动态添加/删除 Hook 规则（本阶段只读配置）

## 验收标准

- AC1: 创建包含多条规则的 `hooks.yaml`，启动 Codia，校验通过的规则被加载，格式错误的规则被跳过并在日志中可见
- AC2: 定义一条 `pre_tool` + `command` 规则，条件匹配 Bash 工具且 command 包含 `rm`，拦截拒绝并返回原因给模型
- AC3: 定义一条 `pre_llm` + `prompt` 规则，每次发送给模型前注入自定义提示词，从模型回复中能观察到提示词的效果
- AC4: 定义一条 `post_tool` + `command` 规则，工具执行完后记录日志到文件，检查日志文件确认写入
- AC5: 定义一条 `turn_start` + `http` 规则，每轮开始时向 webhook URL 发送通知
- AC6: 故意写一条动作会失败的规则（如命令不存在），触发该规则时 Agent 主流程不中断，错误仅出现在日志中
- AC7: `pre_tool` 事件上的 Hook 设置 `background: true`，加载时被校验拒绝并记录警告
- AC8: 无条件规则（省略 `if`）在每次对应事件触发时都执行
