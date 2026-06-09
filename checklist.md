# Codia 基础对话 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性
- [ ] T4 配置读取——loadConfig 正确读取有效 YAML，缺失文件/格式错误均抛 ConfigError（验证：运行 `pnpm test`，config 相关测试通过）
- [ ] T9 HistoryManager——JSONL 读写正常，空文件返回 []，损坏行跳过（验证：运行 `pnpm test`，history 相关测试通过）
- [ ] T10 ContextBuilder——正确拼接 system prompt + 历史 + 新消息（验证：运行 `pnpm test`，context 相关测试通过）
- [ ] T5 SSE 解析——正确解析单事件、多事件、[DONE]、错误事件（验证：运行 `pnpm test`，SSE 相关测试通过）
- [ ] T6+T7 Provider——AnthropicProvider 和 OpenAIProvider 各自实现 LLMProvider 接口（验证：调用 `createProvider` 返回正确实例）

## 集成
- [ ] ChatService 正确串联 HistoryManager → ContextBuilder → Provider（验证：Mock Provider 做集成测试，sendMessage 返回正确 Chunk 序列）
- [ ] TUI App 组件正确组合 InputBox、ChatView、ThinkingBox、StatusBar（验证：`./bin/codia.ts` 启动后四个子组件均可见）
- [ ] 流式 Chunk 正确传递：Provider → ChatService → TUI 逐字渲染（验证：输入消息后观察终端文本逐字出现）
- [ ] 取消机制——Ctrl+C 中断流式但保留已接收内容（验证：流式中按 Ctrl+C，已显示的文本保留，输入框恢复）

## 编译与测试
- [ ] `tsc --noEmit` 无类型错误
- [ ] `pnpm test` 全部测试通过
- [ ] `./bin/codia.ts` 可启动（验证：N1 冷启动 < 1 秒）

## 端到端场景
- [ ] 场景 1（纯对话）：启动 Codia → 输入 "你好，用中文介绍一下你自己" → AI 流式回复 → 输入 "用一句话总结你刚才说的" → AI 引用上文总结 → 退出 → 重新启动 → 历史仍在
- [ ] 场景 2（配置错误）：删除 `codia.yaml` → 启动 Codia → 显示 "未找到 codia.yaml，请先创建配置文件" 并退出
- [ ] 场景 3（认证错误）：`codia.yaml` 填错误的 api_key → 启动 → 输入消息 → 显示红色认证错误信息
- [ ] 场景 4（后端切换）：修改 `codia.yaml` protocol 为 openai 并配置正确 key → 重启 → 输入消息 → OpenAI 后端正常流式回复
- [ ] 场景 5（extended thinking）：使用 Anthropic 后端 → 输入复杂问题 → thinking 内容以灰色/斜体流式展示 → 按 Ctrl+T 折叠 → 再按 Ctrl+T 展开
- [ ] 场景 6（取消流式）：输入一个会触发长回复的问题 → 流式进行中按 Ctrl+C → 输出停止 → 输入框恢复可输入 → 重新启动 → 被中断的回复已保存（标记为中断）

## 验证故事

> 按以下故事手动验证，无需额外脚本。

### 故事 1：首次对话
```
$ codia
> 你好
  (AI 流式回复逐字出现)
  Model: claude-sonnet-4-6-20250514  in:12 out:45
> 再见
  (AI 回复)
$ codia
  (之前的 "你好" 和 "再见" 对话仍在)
```

### 故事 2：配置容错
```
$ rm codia.yaml
$ codia
  未找到 codia.yaml，请先创建配置文件
$ echo "bad yaml" > codia.yaml
$ codia
  配置文件格式错误：...
```
