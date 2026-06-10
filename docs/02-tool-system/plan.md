# Codia 工具系统 Plan

## 架构概览

在现有四层架构上增加 Tool 层，改动集中在 Provider 层和 ChatService 层：

```
                          ┌──────────────────────┐
                          │   Tool Layer (新增)    │
    src/tool/             │  Tool 接口 + 6 个实现  │
    types.ts              │  ToolRegistry         │
    registry.ts           │  ToolExecutor         │
    tools/*.ts            │  CommandExitMap       │
                          └──────────┬───────────┘
                                     │
  ┌──────────────────────────────────┼──────────────────────────┐
  │                                  │                          │
  │  现有层                          │                          │
  │                                  │                          │
  │  TUI (修改)         ChatService (修改)       Provider (修改) │
  │  app.tsx            chat-service.ts         types.ts (+Chunk)│
  │  chat-view.tsx      context.ts              anthropic.ts     │
  │                     history.ts              sse.ts           │
  └──────────────────────────────────┼──────────────────────────┘
                                     │
                          ┌──────────┴───────────┐
                          │  Config (不变)        │
                          │  codia.yaml           │
                          └──────────────────────┘
```

新增 `src/tool/` 目录（9 个文件），修改 6 个现有文件。
核心思路：Tool 层是纯逻辑层，不依赖 TUI 或 Provider。ChatService 编排「调模型→调工具→再调模型」的单次循环。

## 核心数据结构

### Tool 接口
```typescript
interface Tool {
  readonly name: string;
  readonly description: string;
  readonly type: "file" | "shell" | "search";
  readonly readOnly: boolean;
  readonly destructive: boolean;
  readonly inputSchema: ToolInputSchema;
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

interface ToolInputSchema {
  type: "object";
  properties: Record<string, {
    type: string;
    description: string;
    default?: unknown;
    enum?: string[];
  }>;
  required?: string[];
}

interface ToolContext {
  cwd: string;
  signal: AbortSignal;
}
```

### ToolResult
```typescript
interface ToolResult {
  status: "success" | "error";
  content: string;
  metadata?: {
    bytesWritten?: number;
    lineCount?: number;
    fileCount?: number;
    duration?: number;
    exitCode?: number;
  };
}
```

### ToolMeta — 转给 API 的工具描述
```typescript
interface ToolMeta {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}
```

### Chunk 新增类型
```typescript
// 在现有 Chunk 联合类型上新增：
type Chunk =
  // ... text/thinking/usage/error/done ...
  | { type: "tool_use"; call: ToolCall }
  | { type: "tool_status"; name: string; param: string }
```

### ToolCall
```typescript
interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
```

### Message 扩展
```typescript
// 现有 Message 新增字段：
interface Message {
  // ... role/content/timestamp/usage/thinking ...
  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
  toolUseId?: string;
}
```

### CommandExitMap
```typescript
const COMMAND_EXIT_MAP: Record<string, number[]> = {
  grep: [0, 1],    // 1 = 无匹配
  diff: [0, 1],    // 1 = 有差异
  find: [0],
  ls: [0],
  cat: [0], head: [0], tail: [0],
  mkdir: [0], touch: [0],
  // 未列出默认：[0]
};
```

## 模块设计

### 新增模块

#### G: types.ts — Tool 类型定义
**依赖：** 无

#### H: registry.ts — ToolRegistry
**对外接口：** register(), get(), getAllMetas(), getAll()
**依赖：** G

#### I: command-exit-map.ts — 命令语义表
**对外接口：** isSuccessfulExit(command, exitCode): boolean
**依赖：** 无

#### J1-J6: tools/*.ts — 六个工具实现

- **ReadFileTool**: 二进制检测（前 512B 有 null byte → 走 cat），文本走 fs.readFileSync
- **WriteFileTool**: 递归创建父目录 → fs.writeFileSync → "确认写入 N 字节到 <path>"
- **EditFileTool**: 读文件 → 匹配 oldString（0=报错，多=扩展上下文）→ 替换 → 返回行号 diff 预览
- **RunCommandTool**: child_process.exec, stdout+stderr 合并, >10000 截断, 标签包裹
- **GlobTool**: fs.globSync, >200 截断提示
- **GrepTool**: 逐行匹配, >200 截断提示

#### K: executor.ts — ToolExecutor
**对外接口：** executeTool(call, context, registry): Promise<{ result, name }>
**依赖：** G, H

### 修改模块

#### L: provider/types.ts
- Chunk 新增 tool_use、tool_status
- Message 新增 toolCalls、toolResult、toolUseId

#### M: provider/anthropic.ts
- buildRequestBody 加入 tools, 保留 tool_use message 的 content
- streamChat 解析 content_block_start/content_block_delta 产出 tool_use/tool_status chunk

#### N: provider/sse.ts
- mapToChunk 支持 tool_use 事件类型

#### O: chat/chat-service.ts
- 构造时注册 6 个工具 + 创建 ToolExecutor
- sendMessage 增加工具循环：调模型→解析 tool_use→执行→结果回灌→再调模型

#### P: chat/context.ts
- buildMessages 支持 tool_use/tool_result 消息拼接

#### Q: TUI (app.tsx, chat-view.tsx)
- 处理 tool_status chunk，显示 "🔧 工具名 @ 参数"

## 模块交互

### 工具调用流程
```
用户消息 → sendMessage()
  │
  ▼
第一次 streamChat(messages, tools)
  │
  ├── 模型返回 text → 正常流式渲染（当前逻辑）
  │
  └── 模型返回 tool_use → 收集 ToolCall
        │
        ▼
      tool_status chunk → TUI 展示 "🔧 read_file src/index.ts"
        │
        ▼
      executor.executeTool(call, context, registry)
        │
        ├── 工具不存在 → error result
        ├── 执行异常 → error result
        ├── 超时 → error result
        └── 正常 → success result
        │
        ▼
      tool_status done → TUI 清除状态
        │
        ▼
      messages.push(assistant(tool_use) + user(tool_result))
      append 到 JSONL
        │
        ▼
第二次 streamChat(messages, tools)
  │
  ▼
模型给最终 text → 流式渲染
```

## 文件组织

```
src/
├── tool/                          — 新增
│   ├── types.ts
│   ├── registry.ts
│   ├── command-exit-map.ts
│   ├── executor.ts
│   └── tools/
│       ├── read-file.ts
│       ├── write-file.ts
│       ├── edit-file.ts
│       ├── run-command.ts
│       ├── glob.ts
│       └── grep.ts
├── provider/
│   ├── types.ts                   — 修改
│   ├── anthropic.ts               — 修改
│   ├── sse.ts                     — 修改
├── chat/
│   ├── chat-service.ts            — 修改
│   ├── context.ts                 — 修改
└── tui/
    ├── app.tsx                    — 修改
    └── chat-view.tsx              — 修改
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| Tool 接口风格 | 面向对象接口 | 每个工具独立模块，execute 自然封装 |
| 工具注册时机 | ChatService 构造时注册 | 当前集中注册最简单，后续可扩展 |
| tool_use 解析 | SSE 层解析 content_block_start/delta | 利用 Anthropic 协议自带 id 精确重建 |
| 工具循环次数 | 最多 1 次 | spec 明确不做 Agent Loop |
| 输出截断策略 | >10000 字符截前后 | 模型需确认头尾 |
| 二进制检测 | 前 512B 查 null byte | Unix file 命令简化版，零依赖 |
| glob 实现 | Node.js v22 fs.globSync | 零依赖，支持 ** |
| grep 实现 | 自写逐行匹配 | 结果格式可控，不依赖系统 grep |
| edit 匹配扩展 | 左右交替各扩展一行 | 保证唯一匹配，扩展有自然上下文 |
