# Agent Loop Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] `src/agent/types.ts` — 所有 agent 层类型定义完整且可被其他模块导入（验证：`pnpm typecheck` 通过）
- [ ] `src/agent/stream-collector.ts` — StreamCollector 实现双重输出（验证：流式收集器单元测试通过）
- [ ] `src/agent/tool-scheduler.ts` — ToolScheduler 实现按安全性分批（验证：调度器单元测试通过）
- [ ] `src/agent/plan-mode.ts` — Plan Mode prompt 和命令解析可用（验证：plan-mode 测试通过）
- [ ] `src/agent/loop.ts` — AgentLoop 核心循环可用（验证：loop 测试通过）
- [ ] `src/tool/registry.ts` — 新增过滤方法（验证：现有测试 + typecheck 通过）
- [ ] `src/chat/chat-service.ts` — ChatService 成功调用 AgentLoop（验证：`pnpm typecheck` 通过，sendMessage 返回 AsyncIterable<AgentEvent>）
- [ ] `src/config/index.ts` — agent_loop 配置可解析（验证：config 测试通过）

## 集成

- [ ] AgentLoop 正确消费 Provider 的流式输出（验证：mock provider 返回多块 chunk，loop 正确收集并转发）
- [ ] AgentLoop 正确构建 API 消息格式（验证：mock provider 捕获传入的 messages 和 tools 参数，确认格式正确）
- [ ] Plan Mode 下工具列表仅包含只读工具（验证：启动 plan mode，mock provider 捕获到 tools 参数中无 write_file 等写工具）
- [ ] ChatService 管理 Plan Mode 状态切换（验证：连续 /plan → 探索 → /do 命令序列，mode 状态正确切换）

## 编译与测试

- [ ] `pnpm typecheck` 无错误
- [ ] `pnpm test` 全部通过（包括现有测试和新测试）

## 端到端场景

- [ ] **场景 1：多步任务** — 给 LLM 一个需要 2+ 轮工具调用的任务（如"读取 package.json 中的 name 字段，然后更新 README.md 的标题为这个 name"），观察 AgentLoop 自主完成读取 → 写入的多轮循环，最终输出完成结果。验证：观察终端日志，至少看到 2 次 round_start 事件
- [ ] **场景 2：取消中断** — 在一个较长的任务执行过程中按 Ctrl+C，观察立即输出 `reason: "cancelled"` 的 stopped 事件，界面不再有新输出
- [ ] **场景 3：迭代上限** — 在终端执行时故意限制 max_rounds=2，给一个复杂任务，观察 2 轮后输出 `reason: "max_rounds"` 的 stopped 事件并终止
- [ ] **场景 4：Plan Mode** — 输入 `/plan 实现一个日志模块`，观察：(a) 模型只使用 read_file/grep/glob 等只读工具探索代码，(b) 没有修改任何文件，(c) 输出执行计划。然后输入 `/do`，模型开始实际编码
- [ ] **场景 5：多工具并发** — 给 LLM 一个需要同时读 3 个不同文件的任务，观察 batch 内的只读工具被并发执行

## 对照 spec 验收标准

| Spec AC | Checklist 条目 |
|---------|---------------|
| AC1: 多步任务自主循环 | 端到端场景 1 |
| AC2: Ctrl+C 取消 | 端到端场景 2 |
| AC3: 迭代上限终止 | 端到端场景 3 |
| AC4: 只读工具并发 | 端到端场景 5 |
| AC5: 混合工具分批 | ToolScheduler 单元测试(T10) |
| AC6: Plan Mode /plan + /do | 端到端场景 4 |
