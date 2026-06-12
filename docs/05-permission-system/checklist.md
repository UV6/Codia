# Codia 权限系统 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] 所有新建文件存在且编译通过（验证：`pnpm typecheck` 无错误）
- [ ] 所有公开接口可通过 `src/permission/index.ts` 导入（验证：`pnpm typecheck` 通过）
- [ ] ToolResult 支持 `permissionDenied` 字段（验证：`pnpm typecheck` 通过）
- [ ] AgentLoopConfig 支持 `permissionMode` 和 `humanInTheLoop`（验证：`pnpm typecheck` 通过）

## 单元测试通过

- [ ] Blacklist 测试通过：危险命令拦截 + 正常命令放行（验证：`pnpm test -- blocklist`）
- [ ] PathSandbox 测试通过：路径逃逸拒绝 + 正常路径放行 + 符号链接逃逸拒绝（验证：`pnpm test -- path-sandbox`）
- [ ] RuleEngine 测试通过：allow/deny 匹配、glob 模式、deny-anywhere 否决、三层优先级（验证：`pnpm test -- rule-engine`）
- [ ] ModeEvaluator 测试通过：四档模式对三种工具类型的正确行为（验证：`pnpm test -- mode-evaluator`）
- [ ] PermissionChecker 集成测试通过：五层决策链正确穿透（验证：`pnpm test -- checker`）

## 项目构建

- [ ] `pnpm test` 全部通过
- [ ] `pnpm typecheck` 通过

## 端到端场景

- [ ] 场景 1：default 模式下，`read_file` 直接放行，`Bash(git log)` 触发用户确认 → 用户选是，命令执行成功
- [ ] 场景 2：用户选否 → 模型收到 permissionDenied 错误，Loop 继续运行，模型尝试替代方案
- [ ] 场景 3：用户选始终允许 → `Bash(git *)` 写入 permissions.local.yaml，后续 `Bash(git status)` 不再询问
- [ ] 场景 4：plan 模式下，`write_file` 被直接拒绝，模型收到错误提示
- [ ] 场景 5：bypassPermissions 模式下，`Bash(rm -rf /)` 依然被 Layer 1 拦截
- [ ] 场景 6：default 模式下 `Write(/etc/hosts)` 被 Layer 2 路径沙箱拒绝
- [ ] 场景 7：项目级 rules 中 `Bash(npm *): allow`，本地覆盖层 `Bash(npm publish): deny` → `npm publish` 被拦截
- [ ] 场景 8：没有任何规则匹配 `Bash(echo hello)` → default 模式下触发确认 → 用户选是，本次放行，不持久化规则
