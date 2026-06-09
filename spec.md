# Codia 基础对话 Spec

## 背景
当前仓库为空项目骨架。需要从零构建一个终端 AI 编程助手 Codia，
第一步实现纯文本对话能力——用户输入问题，AI 流式回复。这是后续
agent/tool use 功能的基础。

## 目标
- 用户在终端获得一个可用的 AI 对话界面（Ink TUI）
- 支持 Anthropic Claude 和 OpenAI 两种后端，通过 YAML 配置切换
- AI 回复以 SSE 流式逐字打印，非一次性返回
- 支持多轮对话，上下文在会话内保留，关闭后可恢复
- 支持 Claude extended thinking（流式 thinking 过程展示）
- Provider 层提供统一抽象接口，方便后续扩展

## 功能需求
- F1: 用户启动 `codia` 命令后进入 Ink TUI 交互界面，类似 Claude Code 的视觉风格（用户输入和 AI 回复有明显视觉区分）
- F2: 用户输入文本后按回车提交，AI 回复以 SSE 流式逐字/逐 token 打印到终端，支持中途取消（Ctrl+C 中断流式输出）
- F3: 支持多轮对话——AI 能记住同一会话中之前的所有消息
- F4: 对话历史持久化——关闭程序后历史存为 JSONL 文件（每行一条消息对象），下次启动自动恢复上次对话
- F5: 通过仓库根目录下的 YAML 配置文件指定 LLM 后端（protocol、model、base_url、api_key 四个核心字段）
- F6: 支持 Anthropic Claude 协议——消息发送、SSE 流式接收、extended thinking 的 thinking 内容流式展示
- F7: 支持 OpenAI 协议——消息发送、SSE 流式接收
- F8: Provider 层定义统一抽象接口 `streamChat(messages, config)` → `AsyncIterable<chunk>`，AnthropicProvider 和 OpenAIProvider 各自实现
- F9: 对话中显示当前使用的模型名称和 token 用量（每次回复后）

## 非功能需求
- N1: 启动速度——冷启动到 TUI 就绪 < 1 秒
- N2: 流式延迟——首个 token 出现在屏幕上的时间 < 500ms（网络正常时）
- N3: 配置文件缺失或格式错误时给出明确提示，不崩溃
- N4: API 认证失败时给出可读的错误信息（区分网络错误、认证错误、限流错误）
- N5: 安装方式为 `npm install -g` 或 `npx`，`codia` 命令可直接在终端使用

## 不做的事
- 不做 tool use / function calling（留给后续迭代）
- 不做文件读写、代码编辑、shell 执行等 agent 功能
- 不做多会话管理（本次只有单个对话历史文件）
- 不做系统提示词（system prompt）自定义——使用内置默认值
- 不做 MCP（Model Context Protocol）集成
- 不做会话分支/回退
- 不做对话内搜索/过滤

## 验收标准
- AC1: 执行 `npx codia` 或 `codia` 进入 TUI 界面，能看到输入提示符，可输入文本
- AC2: 输入 "你好" 后，AI 回复逐字流式出现在终端
- AC3: 流式输出过程中按 Ctrl+C，输出停止，返回输入状态
- AC4: 输入 "我刚才说了什么？"，AI 能引用本轮对话之前的内容
- AC5: 退出 Codia 后重新启动，之前的对话历史仍在
- AC6: 修改 `codia.yaml` 中 protocol 字段切换后端，重启后生效
- AC7: 使用 Anthropic 后端时，思考过程以不同视觉风格流式展示
- AC8: 每次 AI 回复完成后，在回复末尾显示模型名称和本次 token 用量
- AC9: 配置文件缺失时启动报错 "未找到 codia.yaml，请先创建配置文件" 并退出
- AC10: 填写错误的 api_key，发送消息后显示可读的认证错误信息
