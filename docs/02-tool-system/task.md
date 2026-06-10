# Codia 工具系统 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/tool/types.ts` | Tool/ToolResult/ToolContext/ToolMeta/ToolCall 类型 |
| 新建 | `src/tool/command-exit-map.ts` | 命令语义表 |
| 新建 | `src/tool/registry.ts` | ToolRegistry |
| 新建 | `src/tool/executor.ts` | ToolExecutor |
| 新建 | `src/tool/tools/read-file.ts` | ReadFileTool |
| 新建 | `src/tool/tools/write-file.ts` | WriteFileTool |
| 新建 | `src/tool/tools/edit-file.ts` | EditFileTool |
| 新建 | `src/tool/tools/run-command.ts` | RunCommandTool |
| 新建 | `src/tool/tools/glob.ts` | GlobTool |
| 新建 | `src/tool/tools/grep.ts` | GrepTool |
| 修改 | `src/provider/types.ts` | Chunk 加 tool_use/tool_status，Message 扩展 |
| 修改 | `src/provider/sse.ts` | mapToChunk 支持 tool_use 事件 |
| 修改 | `src/provider/anthropic.ts` | 加 tools + tool_use 解析 |
| 修改 | `src/chat/context.ts` | buildMessages 支持 tool_use/tool_result |
| 修改 | `src/chat/chat-service.ts` | 工具循环 + ToolRegistry 集成 |
| 修改 | `src/tui/app.tsx` | 处理 tool_status chunk |
| 修改 | `src/tui/chat-view.tsx` | 渲染工具状态行 |

## T1: Tool 类型定义

**文件：** `src/tool/types.ts`
**依赖：** 无
**步骤：**
1. 定义 `ToolInputSchema` 接口
2. 定义 `ToolContext` 接口
3. 定义 `ToolResult` 接口（status, content, metadata?）
4. 定义 `ToolMeta` 接口（符合 Anthropic API tools 格式）
5. 定义 `ToolCall` 接口（id, name, input）
6. 定义 `Tool` 接口（name, description, type, readOnly, destructive, inputSchema, execute）

**验证：** `tsc --noEmit` 无类型错误

## T2: 命令语义表

**文件：** `src/tool/command-exit-map.ts`
**依赖：** 无
**步骤：**
1. 定义 `COMMAND_EXIT_MAP: Record<string, number[]>`，含 grep/diff/find/ls/cat/head/tail/mkdir/touch
2. 导出 `isSuccessfulExit(command: string, exitCode: number): boolean`
3. 提取命令名逻辑：取 command 的第一个空格前的部分

**验证：** `pnpm test` — isSuccessfulExit("grep", 1) → true, isSuccessfulExit("cat", 1) → false

## T3: ToolRegistry

**文件：** `src/tool/registry.ts`
**依赖：** T1
**步骤：**
1. 实现 `ToolRegistry` 类：内部 Map<string, Tool>
2. `register(tool)` — 存到 Map
3. `get(name)` — 按名查找
4. `getType(name)` — 返回 type 或 undefined
5. `getAllMetas()` — 遍历所有 Tool，提取 name/description/input_schema
6. `getAll()` — 返回全部 Tool

**验证：** `pnpm test` — register + get + getAllMetas 正确

## T4: ReadFileTool

**文件：** `src/tool/tools/read-file.ts`
**依赖：** T1
**步骤：**
1. 实现 `ReadFileTool implements Tool`，type="file", readOnly=true, destructive=false
2. inputSchema: filePath(required, string), limit(optional, number), offset(optional, number, default 1)
3. execute: 读前 512 字节 → 有 null byte 则返回 error "二进制文件，请用 run_command cat 读取"
4. 文本文件：fs.readFileSync + 按 offset/limit 截行
5. 文件不存在 → `{ status: "error", content: "..." }`

**验证：** `pnpm test` — 读存在的文件 ok，读不存在的文件 error，二进制文件 error

## T5: WriteFileTool

**文件：** `src/tool/tools/write-file.ts`
**依赖：** T1
**步骤：**
1. 实现 `WriteFileTool implements Tool`，type="file", readOnly=false, destructive=true
2. inputSchema: filePath(required), content(required)
3. execute: mkdir recursive → writeFileSync → 返回 `确认写入 N 字节到 <path>`
4. 权限错误 → error result

**验证：** `pnpm test` — 写文件 + 读回确认内容一致；写深层目录自动创建父目录

## T6: EditFileTool

**文件：** `src/tool/tools/edit-file.ts`
**依赖：** T1
**步骤：**
1. 实现 `EditFileTool implements Tool`，type="file", readOnly=false, destructive=true
2. inputSchema: filePath(required), oldString(required), newString(required)
3. execute 核心逻辑：
   - 读文件全部内容
   - 统计 oldString 出现次数
   - 0 次 → error "未找到匹配内容"
   - 1 次 → 直接替换
   - N 次 → 逐步扩大 oldString（从首尾各扩展一行原文，循环直到唯一）
     - 扩展中只剩一次匹配 → 替换
     - 扩展到整个文件仍不唯一 → error "匹配不唯一（N 处），需要更多上下文"
   - 替换后保存文件
   - 返回 diff preview：替换位置前后各 3 行，带行号
4. 文件不存在 → error

**验证：** `pnpm test` — 唯一匹配替换 ok，0 次匹配报错，多处匹配扩展后替换 ok

## T7: GlobTool

**文件：** `src/tool/tools/glob.ts`
**依赖：** T1
**步骤：**
1. 实现 `GlobTool implements Tool`，type="search", readOnly=true, destructive=false
2. inputSchema: pattern(required), dir(optional, default ".")
3. execute: fs.globSync 或手动递归匹配
4. 支持 **（递归匹配子目录）
5. >200 结果 → 截断前 200 + 提示 "... 还有 N 个文件未列出，请缩小搜索范围"
6. dir 不存在 → error

**验证：** `pnpm test` — pattern `*.ts` 返回 .ts 文件，** 递归匹配

## T8: GrepTool

**文件：** `src/tool/tools/grep.ts`
**依赖：** T1
**步骤：**
1. 实现 `GrepTool implements Tool`，type="search", readOnly=true, destructive=false
2. inputSchema: pattern(required), dir(optional, default "."), include(optional, 文件过滤 glob)
3. execute: 遍历目标文件 → 逐行匹配 → 收集 `file:line: 匹配行内容`
4. >200 行 → 截断 + 提示缩小搜索范围
5. 正则出错 → error result

**验证：** `pnpm test` — 搜到匹配行，搜不到返回空，正则错误报错

## T9: RunCommandTool

**文件：** `src/tool/tools/run-command.ts`
**依赖：** T1, T2
**步骤：**
1. 实现 `RunCommandTool implements Tool`，type="shell", readOnly=false, destructive=true
2. inputSchema: command(required), cwd(optional), timeout(optional, default 30)
3. execute: child_process.exec(command, { cwd, timeout, maxBuffer: 1MB })
4. 合并 stdout+stderr → >10000 字符截断（前 2000 + 后 8000 + 截断提示）
5. 提取命令名 → 查 isSuccessfulExit → 决定 status
6. 返回格式：
   ```
   <output>合并输出</output>
   <exit_code>N</exit_code>
   ```
7. 超时：先 SIGTERM → 2s 不退出再 SIGKILL

**验证：** `pnpm test` — echo 正常，不存在的命令 error，sleep 3 秒 + timeout 1 秒测试超时

## T10: ToolExecutor

**文件：** `src/tool/executor.ts`
**依赖：** T1, T3
**步骤：**
1. 实现 `executeTool(call, context, registry): Promise<{ result, name }>`
2. 流程：get 工具 → 不存在 → error result
3. 记录开始时间 → execute → 计算 duration
4. try-catch 所有异常 → error result
5. result.metadata 中添加 duration

**验证：** `pnpm test` — mock Tool 成功/失败，不存在工具返回 error

## T11: Provider 类型扩展

**文件：** `src/provider/types.ts`
**依赖：** T1（ToolCall 类型）
**步骤：**
1. Chunk 联合类型新增：
   - `{ type: "tool_use"; call: ToolCall }`
   - `{ type: "tool_status"; name: string; param: string }`
2. Message 新增可选字段：`toolCalls?: ToolCall[]`, `toolResult?: ToolResult`, `toolUseId?: string`

**验证：** `tsc --noEmit` 无类型错误

## T12: SSE 解析扩展

**文件：** `src/provider/sse.ts`
**依赖：** T11
**步骤：**
1. mapToChunk 新增 Anthropic 事件处理：
   - `content_block_start`（content_block.type === "tool_use"）→ 暂存 tool_use id/name
   - `content_block_delta`（delta.type === "input_json_delta"）→ 拼接 JSON 碎片
   - JSON 完整时 → yield `{ type: "tool_use", call }`

**验证：** `pnpm test` — mock tool_use SSE 事件，确认正确解析为 ToolCall

## T13: AnthropicProvider 修改

**文件：** `src/provider/anthropic.ts`
**依赖：** T11, T12
**步骤：**
1. streamChat 签名加入 `tools?: ToolMeta[]` 参数
2. buildRequestBody: tools 非空时加 `tools` 字段
3. buildRequestBody: assistant 消息含 toolCalls 时转为 content blocks 格式
4. buildRequestBody: tool_result 消息以 user role + tool_result content block 加入

**验证：** `tsc --noEmit`，后续端到端验证

## T14: ContextBuilder 修改

**文件：** `src/chat/context.ts`
**依赖：** T11
**步骤：**
1. buildMessages: assistant 消息有 toolCalls 时保留 content（文本部分）
2. tool_result 消息以 user role 加入消息列表

**验证：** `pnpm test` — 含 tool_use 和 tool_result 的历史消息正确拼接

## T15: ChatService 工具集成

**文件：** `src/chat/chat-service.ts`
**依赖：** T3, T10, T13, T14
**步骤：**
1. 构造器中创建 ToolRegistry + 注册 6 个 Tool
2. 构造器中创建 ToolContext（cwd = process.cwd()）
3. sendMessage 重构：第一次调模型 → 收集 tool_use → 执行工具 → 结果回灌 → 第二次调模型
4. tool_use/tool_result 消息写入 JSONL

**验证：** 端到端测试（需要 API key）

## T16: TUI 工具状态展示

**文件：** `src/tui/app.tsx`, `src/tui/chat-view.tsx`
**依赖：** T15
**步骤：**
1. App handleSubmit: 处理 tool_status chunk，显示/清除工具状态
2. ChatView: 蓝色/cyan 工具状态行（🔧 图标）

**验证：** 端到端测试

## 执行顺序

```
T1 ──→ T3 ──→ T10 ──┐
        │              │
T2 ─────┘              ├──→ T15 ──→ T16
                       │
T1 ──→ T4 ────────────┤
T1 ──→ T5 ────────────┤
T1 ──→ T6 ────────────┤
T1 ──→ T7 ────────────┤
T1 ──→ T8 ────────────┤
T1 ──→ T9 ────────────┘

T11 ──→ T12 ──→ T13 ──→ T15
                    └──→ T14 ──┘
```

共 16 个任务。T2-T9 可并行（都依赖 T1）。T11→T12→T13 串行。两条线在 T15 汇合。
