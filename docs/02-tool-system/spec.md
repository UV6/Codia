# Codia 工具系统 Spec

## 背景
v0.1.0 已实现纯文本对话。模型能回答问题但无法接触用户的文件系统。
需要给它装上"手"和"眼"——读文件、写文件、改文件、执行命令、
搜索代码，从聊天机器人变成能干活的 Agent。

当前架构：Ink TUI → ChatService → Provider(Anthropic/OpenAI)
DeepSeek 后端已通过 Anthropic 协议接入，支持 tool_use 功能。

## 目标
- 定义统一的 Tool 接口和 ToolRegistry 注册中心
- 实现六个核心工具：read_file, write_file, edit_file, run_command, glob, grep
- ChatService.sendMessage() 内部支持单次「工具调用 → 执行 → 结果回灌 → 最终回复」
- 工具执行带超时保护（默认 30 秒）和结构化错误返回
- edit_file 走智能匹配替换（多处匹配时逐步扩大上下文）
- TUI 流式展示工具调用过程（如"🔧 read_file src/index.ts..."）

## 功能需求

### 工具基础设施
- F1: 定义统一的 Tool 接口，每个工具包含：
  - name — 工具名称
  - description — 用途描述
  - type — "file" | "shell" | "search"
  - readOnly — 是否只读
  - destructive — 是否具有破坏性（后续权限更严格）
  - inputSchema — JSON Schema 参数定义
  - execute 方法

  六工具分类：
  | 工具 | type | readOnly | destructive |
  |------|------|----------|-------------|
  | read_file | file | ✅ | ❌ |
  | write_file | file | ❌ | ✅ |
  | edit_file | file | ❌ | ✅ |
  | run_command | shell | ❌ | ✅ |
  | glob | search | ✅ | ❌ |
  | grep | search | ✅ | ❌ |

- F2: ToolRegistry 注册中心，支持 register(Tool) 和 getToolMetas()（生成符合 Anthropic API 的 tools 数组）、按名查找

### 六个核心工具

- F3: read_file
  - 参数：filePath（必填）、limit（可选）、offset（可选，默认 1）
  - 二进制文件检测后交给 run_command 用 `cat` 读取
  - 出错返回结构化错误

- F4: write_file
  - 参数：filePath、content
  - 父目录不存在时自动递归创建
  - 成功返回 `确认写入 N 字节到 <path>`

- F5: edit_file
  - 参数：filePath、oldString、newString
  - 零次匹配 → 报错 "未找到匹配内容"
  - 多处匹配 → 逐步增大 oldString（向两端扩展上下文）直到匹配唯一
  - 替换成功后返回带行号的 diff 预览（替换位置前后各 3 行）

- F6: run_command
  - 参数：command、cwd（默认项目根目录）、timeout（默认 30 秒）
  - stdout+stderr 合并，>10000 字符截断（前 2000 + 后 8000）
  - 输出用 `<output>` + `<exit_code>` 标签包裹
  - 命令语义表：grep exitCode=1 为无匹配，diff exitCode=1 为有差异，其余非零=错误

- F7: glob
  - 参数：pattern（支持 **）、dir（默认 cwd）
  - 结果 >200 个文件时截断并提示

- F8: grep
  - 参数：pattern、dir、include（文件过滤）
  - 返回 file:line 格式，>200 行截断提示

### Tool Executor
- F9: ToolExecutor 接收 tool_use 参数，查找+执行，返回 ToolResult
- F10: 工具执行带超时保护
- F11: 异常包裹为结构化结果，不抛异常崩溃

### ChatService 集成
- F12: sendMessage() 内部单次工具调用循环
- F13: Provider 传递 tools 给 API
- F14: Provider 解析流式 tool_use chunk，产出新 Chunk 类型
- F15: tool_use 和 tool_result 消息写入 JSONL

### TUI 展示
- F16: 工具调用中显示状态（"🔧 read_file src/index.ts..."）
- F17: 最终文本回复正常流式展示

## 非功能需求
- N1: 工具执行超时默认 30 秒，可单工具覆盖
- N2: 子进程隔离，崩溃不传导主进程
- N3: 输出截断后保留 `... [已截断中间 N 字符] ...` 提示
- N4: grep 结果 >200 行截断并提示缩小范围
- N5: glob 结果 >200 文件截断并提示
- N6: 写文件不在已有文件上做备份（后续加）

## 不做的事
- 不做自动循环（Agent Loop）——单次工具调用就停
- 不做 approval 确认机制
- 不做文件备份
- 不做并行工具调用
- 不做工具调用历史 UI 折叠
- 不做工具配置用户自定义
- 不做 MCP tool 集成

## 验收标准
- AC1: 启动 Codia，"读取 src/config/index.ts 的内容" → 工具状态显示 → 回复包含文件内容
- AC2: "创建 hello.txt 写 Hello World" → 文件创建 → 回复含"确认写入 N 字节"
- AC3: "把 hello.txt 的 World 改成 Codia" → 匹配成功 → 回复含 diff 预览
- AC4: "执行 ls -la" → 工具状态 → 回复含目录列表和 exitCode=0
- AC5: "执行 sleep 60" → 超时 → 回复含超时错误
- AC6: "用 glob 找 src 下所有 .ts 文件" → 列出匹配文件
- AC7: "用 grep 在 src 下搜索 loadConfig" → file:line 匹配
- AC8: 多处匹配文件 → edit_file 逐步扩展上下文 → 唯一匹配替换成功
- AC9: 工具调用对话退出重启 → JSONL 含 tool_use + tool_result
- AC10: 读取不存在的文件 → 结构化错误 → 模型告知文件不存在
