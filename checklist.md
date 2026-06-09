# Codia 基础对话 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性
- [ ] T4 配置读取——loadConfig 正确读取有效 YAML，缺失文件/格式错误均抛 ConfigError（验证：运行 `pnpm test`，config 相关测试通过）
- [ ] T9 HistoryManager——JSONL 读写正常，空文件返回 []，损坏行跳过（验证：运行 `pnpm test`，history 相关测试通过）
- [ ] T10 ContextBuilder——正确拼接 system prompt + 历史 + 新消息（验证：运行 `pnpm test`，context 相关测试通过）
- [ ] T5 SSE 解析——正确解析单事件、多事件、[DONE]、错误事件（验证：运行 `pnpm test`，SSE 相关测试通过）
- [ ] T6+T7 Provider——AnthropicProvider 和 OpenAIProvider 各自实现 LLMProvider 接口（验证：调用 `createProvider` 返回正确实例）
- [ ] T6b+T7b 错误码映射——Provider 对 401 映射 auth、429 映射 rate_limit、网络异常映射 network（验证：运行 `pnpm test`，error-mapping 测试通过）

## 集成
- [ ] ChatService 正确串联 HistoryManager → ContextBuilder → Provider（验证：Mock Provider 做集成测试，sendMessage 返回正确 Chunk 序列）
- [ ] TUI App 组件正确组合子组件（验证：启动后 InputBox 显示 "Codia >" 前缀，StatusBar 显示在底部，ChatView 区域可见）
- [ ] 流式 Chunk 正确传递：Provider → ChatService → TUI 逐字渲染（验证：输入消息后观察终端文本逐字出现）
- [ ] 首次 token 延迟——提交消息后首个 token 出现在屏幕上无明显等待感（验证：肉眼观察，应该迅速出现；N2 目标 < 500ms）
- [ ] 取消机制——Ctrl+C 中断流式但保留已接收内容（验证：流式中按 Ctrl+C，已显示的文本保留，输入框恢复）
- [ ] 用量展示——每次 AI 回复完成后末尾显示模型名称和 token 用量（验证：观察回复末尾有类似 "Model: xxx  in:N out:M" 的行）

## 编译与测试
- [ ] `tsc --noEmit` 无类型错误
- [ ] `pnpm test` 全部测试通过
- [ ] `./bin/codia.ts` 可启动（验证：N1 冷启动 < 1 秒）

## 端到端场景
- [ ] 场景 1（纯对话）：启动 Codia → 输入 "你好，用中文介绍一下你自己" → AI 流式回复 → 输入 "用一句话总结你刚才说的" → AI 引用上文总结 → 退出 → 重新启动 → 历史仍在
- [ ] 场景 2（配置错误）：删除 `~/.Codia/Codia.yml` → 启动 Codia → 显示 "未找到 ~/.Codia/Codia.yml，请先创建配置文件" 并退出
- [ ] 场景 3a（认证错误）：`~/.Codia/Codia.yml` 填错误的 api_key → 启动 → 输入消息 → 显示红色认证错误信息
- [ ] 场景 3b（网络错误）：`~/.Codia/Codia.yml` 填错误的 base_url（不可达地址）→ 启动 → 输入消息 → 显示可读的网络错误信息
- [ ] 场景 4（后端切换）：修改 `~/.Codia/Codia.yml` protocol 为 openai 并配置正确 key → 重启 → 输入消息 → OpenAI 后端正常流式回复
- [ ] 场景 5a（thinking 视觉区分）：使用 Anthropic 后端 → 输入复杂问题 → thinking 内容以灰色/斜体流式展示，与普通回复有明显视觉区分
- [ ] 场景 5b（thinking 折叠）：thinking 流式展示中 → 按 Ctrl+T 可折叠 → 再按 Ctrl+T 可展开
- [ ] 场景 6（取消流式）：输入一个会触发长回复的问题 → 流式进行中按 Ctrl+C → 输出停止 → 输入框恢复可输入 → 重新启动 → 被中断的回复已保存（标记为中断）

## 验证故事

> 按以下命令手动验证，无需额外脚本。

```
# 故事 1：首次对话
$ codia
> 你好
  (AI 流式回复逐字出现)
  回复末尾: Model: claude-sonnet-4-6-20250514  in:12 out:45
> 再见
  (AI 回复)
$ codia
  (之前的 "你好" 和 "再见" 对话仍在)

# 故事 2：配置容错
$ rm ~/.Codia/Codia.yml
$ codia
  未找到 ~/.Codia/Codia.yml，请先创建配置文件
$ echo "bad yaml" > ~/.Codia/Codia.yml
$ codia
  配置文件格式错误：...

# 故事 3：错误类型区分
$ # 场景 3a: 错误的 api_key
$ codia
> 你好
  (红色) 认证失败，请检查 api_key

$ # 场景 3b: 不可达的 base_url
$ # 改 base_url 为 http://localhost:19999
$ codia
> 你好
  (红色) 网络错误，无法连接到 API 服务器
```
