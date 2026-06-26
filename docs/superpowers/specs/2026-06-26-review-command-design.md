# /review 命令改进设计

## 背景

当前 `/review` 是一个 `prompt` 型命令，只把固定的审查 prompt 注入当前对话，由 LLM 自行判断上下文中的变更。它存在两个问题：

1. LLM 不一定能准确拿到当前 git diff 的内容，审查容易泛泛而谈。
2. 参数只是简单拼接到 prompt 末尾，没有结构化提示。

## 目标

让 `/review` 自动读取工作区未暂存的 git diff，连同优化后的审查 prompt 一起发送给 LLM；支持一个可选的位置参数作为额外关注点。

## 方案

### 1. 命令类型调整

把 `/review` 从 `type: "prompt"` 改为 `type: "local"`，由 `handler` 主动构造完整消息内容，再调用 `ui.sendUserMessage()`。

### 2. UIContext 扩展

在 `UIContext` 中新增 `getCwd(): string`，让命令能获取当前工作目录，避免直接依赖全局 `process.cwd()`，便于测试。

### 3. git diff 读取

在 `handler` 中异步执行 `git diff`（工作区未暂存变更），把输出拼到 prompt 中。

### 4. Prompt 结构

```
请审查当前 git diff 中的代码变更。重点关注：

1. 逻辑错误
2. 安全问题
3. 性能问题
4. 代码风格

请给出具体的审查结论和改进建议。

<git diff 输出>

额外关注：<args>
```

### 5. 边界处理

- 当前没有未暂存变更：通过 `ui.showMessage` 提示 warning，不发送审查请求。
- git 命令执行失败：通过 `ui.showMessage` 提示 error。
- diff 过大：第一版先不截断，直接发送；后续如 token 压力过大再考虑截断或按文件拆分。

## 改动文件

- `src/command/types.ts`：扩展 `UIContext` 接口。
- `src/tui/app.tsx`：在 `uiContext` 中实现 `getCwd`。
- `src/command/builtin/review.ts`：重写为 `local` 型命令，集成 git diff。
- `src/__tests__/command/context.test.ts`：补充 `getCwd` mock。
- `src/__tests__/command/review.test.ts`：新增测试。

## 测试策略

1. 单元测试覆盖：有 diff、无 diff、有额外关注点、git 命令失败。
2. 本地端到端测试：在终端里实际跑 `/review` 和 `/review 关注并发安全`，验证 diff 被正确读取并发送。
