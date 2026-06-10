# Codia 工具系统 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性
- [ ] T1-T2 类型+命令语义表通过（验证：`tsc --noEmit` + `pnpm test`，类型测试和 exit map 测试通过）
- [ ] T3 ToolRegistry 注册/查找/生成 ToolMeta 正确（验证：`pnpm test`）
- [ ] T4-T9 六个工具各自测试通过（验证：`pnpm test`，每个工具有独立测试文件）
- [ ] T10 ToolExecutor 执行/异常捕获/不存在工具处理（验证：`pnpm test`）
- [ ] T11-T12 Provider 类型扩展 + SSE tool_use 解析（验证：`pnpm test`）
- [ ] T13 AnthropicProvider 传递 tools + tool_use 请求构建（验证：`tsc --noEmit`）
- [ ] T14-T15 ChatService 工具循环集成（验证：`tsc --noEmit`）

## 集成
- [ ] ChatService 正确串联 ToolRegistry → ToolExecutor → Provider（验证：Mock 调用 read_file，确认工具被执行且结果回灌）
- [ ] tool_use/tool_result 消息写入 JSONL（验证：工具对话后检查 sessions 文件内容）
- [ ] TUI 展示工具调用状态（验证：发起工具调用 → ChatView 出现蓝色 "🔧 tool_name @ param"）

## 编译与测试
- [ ] `tsc --noEmit` 无类型错误
- [ ] `pnpm test` 全部测试通过
- [ ] `./bin/codia.tsx` 可启动

## 端到端场景
- [ ] 场景 1（读文件）：启动 Codia → "读取 package.json 的内容" → 看到 "🔧 read_file package.json" → AI 回复包含文件内容
- [ ] 场景 2（写文件）：启动 Codia → "创建 /tmp/test-codia.txt，写 Hello Codia" → 文件被创建 → 回复含 "确认写入 N 字节"
- [ ] 场景 3（改文件）：启动 Codia → "把 /tmp/test-codia.txt 的 Hello 改成 Hi" → 回复含带行号的 diff 预览
- [ ] 场景 4（编辑匹配失败）：创建一个有多处重复行的文件 → "修改其中某行" → edit_file 扩展上下文 → 唯一匹配替换成功
- [ ] 场景 5（命令执行）：启动 Codia → "执行 ls -la" → 看到输出和 exitCode=0
- [ ] 场景 6（命令超时）：启动 Codia → "执行 sleep 60" → 30 秒内返回超时错误
- [ ] 场景 7（glob）：启动 Codia → "找 src 下所有 .ts 文件" → 回复列出匹配文件
- [ ] 场景 8（grep）：启动 Codia → "在 src 下搜索 loadConfig" → 回复含 file:line 匹配
- [ ] 场景 9（读取不存在的文件）：启动 Codia → "读取 /tmp/no-such-file.txt" → 结构化错误 → AI 告知文件不存在
- [ ] 场景 10（历史持久化）：工具调用对话 → 退出 → `codia -s <id>` 继续 → 历史含 tool_use + tool_result

## 验证故事

```
# 故事 1：读文件
$ codia
> 帮我读一下 package.json
  🔧 read_file package.json
  (文件内容出现在回复中)

# 故事 2：写+改+查
$ codia
> 创建 /tmp/hello.txt，内容是 Hello World
  确认写入 12 字节到 /tmp/hello.txt

> 把其中 World 改成 Codia
  第1行: -Hello World
  第1行: +Hello Codia
  (带行号的 diff 预览)

> 读一下 /tmp/hello.txt
  Hello Codia

# 故事 3：搜索
$ codia
> 在 src 下搜索所有包含 import 的 .ts 文件
  src/config/index.ts:1: import { readFileSync } from "node:fs"
  src/provider/types.ts:1: import type { ... }
  ...

# 故事 4：命令执行
$ codia
> 执行 ls src/tool/tools/
  <output>
  glob.ts
  grep.ts
  read-file.ts
  run-command.ts
  write-file.ts
  </output>
  <exit_code>0</exit_code>
```
