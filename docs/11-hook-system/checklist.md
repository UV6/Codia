# Hook 系统 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] [types] `HookEvent`、`HookRule`、`HookCondition`、`HookAction`、`HookControl`、`HookContext`、`HookInterceptResult` 等所有类型已导出（验证：`pnpm exec tsc --noEmit` 编译通过）
- [ ] [matcher] `matchCondition` 正确实现四种匹配模式 + 两种逻辑组合（验证：matcher 单元测试全部通过）
- [ ] [loader] `loadHooksFromFile` 能从合法 YAML 加载规则，`loadAllHooks` 合并三层配置（验证：loader 单元测试全部通过）
- [ ] [loader] `validateRule` 对所有非法输入返回具体错误信息（验证：校验测试覆盖 ~12 种错误场景）
- [ ] [executor] `substituteTemplate` 正确替换 `{{field.path}}` 模板变量（验证：executor 单元测试全部通过）
- [ ] [executor] `executeCommand` 执行 shell 命令并返回 stdout，失败返回 null（验证：执行 `echo hello` 并在测试中断言返回值）
- [ ] [executor] `executeHttp` 发送 HTTP 请求（验证：可用 mock fetch 测试）
- [ ] [executor] `executePrompt` 返回替换后的文本
- [ ] [executor] `executeSubagent` 返回 null 并记录 warn 日志（验证：调用后返回值为 null）
- [ ] [engine] `HookEngine` 的 `fire()` 对匹配规则执行动作，不匹配则跳过（验证：engine 单元测试全部通过）
- [ ] [engine] `fireIntercept()` 对 `REJECT:` 输出返回 `{ blocked: true }`，普通输出返回 `{ blocked: false }`（验证：用含 `REJECT:` 的命令动作测试）
- [ ] [engine] `run_once` 标记的规则在同一会话中只执行一次（验证：连续两次 fire 同一事件，计数动作只执行一次）
- [ ] [engine] `background` 规则不阻塞 fire 返回，执行器在后台运行（验证：用延迟命令 + 检查 fire 是否立即返回）
- [ ] [engine] 动作失败不抛出异常，错误仅出现在日志中（验证：故意写一个不存在的命令，fire 正常返回不抛异常）
- [ ] [loader] `validateRule` 对拦截事件 + `background: true` 返回校验错误，加载时跳过该规则并记录 warn（验证：loader 单元测试覆盖，对应 spec AC7）
- [ ] [index] 从 `src/hook/index.ts` 统一导出所有公共 API（验证：编译通过）

## 集成

- [ ] [ToolScheduler] `pre_tool` Hook 拦截工具执行，拒绝原因作为工具结果返回（验证：配置拦截规则后触发对应工具，确认返回内容含 `[系统拦截]`）
- [ ] [ToolScheduler] `post_tool` Hook 在工具执行后触发（验证：配置 post_tool 规则执行 echo 命令 → 检查日志文件写入）
- [ ] [AgentLoop] `turn_start` + http Hook 向 webhook URL 发送通知（验证：mock HTTP server 收到请求，对应 spec AC5）
- [ ] [AgentLoop] `turn_start`/`turn_end` Hook 在每轮迭代时触发（验证：日志可见每轮 Hook 调用）
- [ ] [AgentLoop] `pre_llm` Hook 中 prompt 动作将文本注入 system_prompt（验证：从模型回复中观察到注入的提示词效果）
- [ ] [AgentLoop] `post_llm` Hook 在模型响应后触发（验证：日志或命令执行可见）
- [ ] [ChatService] `session_start` 在会话创建时触发（验证：日志可见 session_start 事件）
- [ ] [ChatService] `session_end` 在会话结束时触发（验证：正常退出后日志可见 session_end 事件）
- [ ] [Bootstrap] `startup` Hook 在启动完成后触发（验证：启动日志中可见 startup 事件触发）
- [ ] [Bootstrap] `shutdown` Hook 在进程退出前触发（验证：Ctrl+C 退出后日志可见 shutdown 事件触发）

## 编译与测试

- [ ] 项目编译无错误（`pnpm exec tsc --noEmit`）
- [ ] 所有单元测试通过（`pnpm test`）
- [ ] 所有现有测试不受影响（`pnpm test` 结果与合并前一致）

## 端到端场景

- [ ] 场景 1：危险命令拦截 — 创建 hooks.yaml 定义 `pre_tool` 规则匹配 Bash + `rm -rf` 命令，执行拒绝脚本。在 Codia 中让 Agent 执行 `rm -rf /some/path`，Agent 收到 `[系统拦截]` 拒绝信息并调整行为，不再尝试执行。
- [ ] 场景 2：上下文注入 — 创建 hooks.yaml 定义 `pre_llm` + prompt 规则："每次回答前说'让我想想...'"。在 Codia 中发送任意消息，从模型回复开头观察到 "让我想想..."。
- [ ] 场景 3：工具审计日志 — 创建 hooks.yaml 定义 `post_tool` + command 规则，将每次工具调用的名称和参数写入 `/tmp/codia-audit.log`。使用 Codia 执行几次工具调用后，检查日志文件正确记录了每个工具调用。
- [ ] 场景 4：错误恢复 — 在 hooks.yaml 中定义一条动作会失败的规则（如执行不存在的命令），正常使用 Codia 时该规则触发但对话流程不受影响，Agent 正常工作。
- [ ] 场景 5：多规则并行 — 在同一个事件（`turn_start`）上定义多条规则（一条 command + 一条 prompt），触发时所有匹配规则都执行，互不影响。

## 不做的事（确认不实现）

- [ ] 子 Agent 动作真实运行：`subagent` 类型动作只记录 warn 日志，不启动实际 SubAgent
- [ ] `run_once` 标记持久化：重启 Codia 后，之前标记为 run_once 的规则会再次执行（内存级别）
- [ ] 显式优先级控制：同一事件的多个 Hook 按配置文件中的顺序执行，不可调整优先级
- [ ] 斜杠命令动态管理 Hook：运行时不支持 `/hook add` 等命令增删规则
