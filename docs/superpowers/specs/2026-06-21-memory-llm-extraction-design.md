# 记忆 LLM 提炼设计

## 背景

当前 `src/memory/extractor.ts` 用关键词启发式提取记忆：用户消息命中 `以后/应该/不要` 等词 → 生成偏好记忆；assistant 回复 > 200 字 → 截取前 3 句 → 生成知识记忆。去重用简单子串匹配。

结果：`memory/` 目录积累了 80+ 条无意义笔记（`ls` 输出片段、随口描述的项目结构等），去重几乎无效。

原始 spec（`docs/08-session-recovery-and-memory/spec.md` F8-F10）已明确要求用 LLM 做去重决策，计划中也写了"去重策略：由 LLM 基于现有索引摘要判断新增/更新/跳过"。本次设计就是在不改 spec 的前提下，把关键词匹配替换为 LLM + tool call 实现。

## 目标

- 用 LLM 替代关键词启发式，每轮结束后自动分析本轮对话是否产生可复用记忆
- LLM 通过 tool call 输出记忆 upsert 或 delete 决策，代码只负责落盘
- 已有记忆索引传给 LLM，让它能判断新增/更新/跳过/删除
- 记忆提取用独立可配置的 model，不影响主对话的性能和成本
- 保持 `store.ts`/`types.ts` 接口不变，只换提取逻辑

## 设计方案

### 流程

```
sendMessage() → AgentLoop 结束
  → scheduleMemoryExtraction(prevCount)
    → 构建提取 prompt（本轮对话 + 已有索引）
    → LLM 调用（可配置 model，默认 haiku）
    → LLM 通过 tool call 输出 MemoryNote → upsert / delete
    → 落盘
    → 失败只记日志，不阻塞主路径
```

### LLM Tool Schema

给提取 LLM 注册 2 个 tool：

```typescript
// Tool 1: memory_upsert
{
  name: "memory_upsert",
  description: `写入或更新一条有跨会话复用价值的记忆。

什么时候调用：
- 用户明确表达偏好/约束时（"以后不要..."、"每次都要..."）
- 用户纠正了 AI 的错误理解时
- 对话中出现了可复用的项目知识（架构决策、命名约定、关键依赖等）
- 对话中出现了有价值的参考资料

什么时候不调用：
- 对话内容是一次性的、只在当前会话有效
- 信息已在已有记忆索引中（此时应调用 memory_skip 说明理由）
- 内容琐碎、没有复用价值`,
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "已有笔记 id（更新时填写），新增时留空" },
      category: {
        type: "string",
        enum: ["user_preference", "correction_feedback", "project_knowledge", "reference_material"],
        description: "记忆分类"
      },
      title: { type: "string", description: "笔记标题，简洁概括要点" },
      body: { type: "string", description: "笔记正文，包含足够上下文使记忆独立可读" },
      summary: { type: "string", description: "一行摘要，用于索引展示" },
      reason: { type: "string", description: "为什么记录这条（便于调试）" },
    },
    required: ["category", "title", "body", "summary", "reason"]
  }
}

// Tool 2: memory_delete
{
  name: "memory_delete",
  description: "删除一条已过时或错误的记忆。仅当已有记忆与当前对话明显矛盾、或已被用户明确推翻时调用。",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "要删除的笔记 id" },
      reason: { type: "string", description: "删除原因" }
    },
    required: ["id", "reason"]
  }
}
```

### 提取 Prompt 结构

```
你是一个记忆提炼助手。分析本轮对话，提取可复用的知识。

## 已有记忆索引
{{renderIndexText(bundle)}}

## 本轮对话
User: {{turnMessages[0].content}}
Assistant: {{turnMessages[1].content}}
...

请调用 memory_upsert / memory_delete 工具来记录或更新记忆。
如果没有值得记录的内容，不调用任何工具即可。
```

### 改动点

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/memory/extractor.ts` | 重写 | 用 LLM + tool call 替换关键词匹配 |
| `src/memory/types.ts` | 新增 tool schema | 输出 `MEMORY_UPSERT_SCHEMA`、`MEMORY_DELETE_SCHEMA` |
| `src/chat/chat-service.ts` | 修改 `scheduleMemoryExtraction` | 传入 provider、model 配置，改为 async/await |
| `src/config/index.ts` | 新增配置项 | `memory.model` 可选覆盖 |

### 不改动

- `src/memory/store.ts` — upsert/delete/readIndex 接口不变
- `src/memory/types.ts` — MemoryNote、MemoryIndexEntry、MemoryIndexBundle 结构不变
- `src/bootstrap/context-builder.ts` — 加载行为不变
- spec 范围不变 — 原来就计划用 LLM

### 配置

```yaml
# codia.yaml 新增
memory:
  model: "haiku"           # 记忆提取专用模型，默认同主模型
  maxTokens: 2000          # 提取 LLM 的 max_tokens
  enabled: true            # 是否启用自动记忆
```

### 容错

- LLM 调用失败 → 只记 warning 日志，不阻塞主对话
- Tool call 格式错误 → 代码层校验并丢弃无效调用
- `memory_delete` 引用的 id 不存在 → 忽略

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 触发时机 | 每轮 AgentLoop 结束后 | 用户选择，与当前行为一致 |
| LLM 输出格式 | Tool call | 结构化约束强，避免 JSON 解析错误和重试 |
| 是否传已有索引给 LLM | 传，且允许输出 delete/update | 让 LLM 能做真正的语义去重和过期清理 |
| 模型选择 | 可配置，默认用主 provider | 用户选择，灵活性优先 |
| memory_delete 用途 | LLM 可标记过时记忆 | 配合已有索引，让 LLM 能清理矛盾或过时信息 |
| LLM 返回内容 | 完整 MemoryNote 结构 | 用户选择，LLM 输出完整字段，代码只管落盘 |

## 验收标准

- AC1: 当一轮对话产生用户偏好内容时（如"以后不要..."），LLM 应调用 memory_upsert 生成 user_preference 笔记
- AC2: 当一轮对话没有可复用内容时，LLM 不应调用任何 tool
- AC3: 当新内容与已有记忆语义重复时，LLM 不应新增，应跳过（不调用 tool 或明确说明跳过原因）
- AC4: 当新内容应该更新已有笔记时，LLM 应调用 memory_upsert 并传入已有 id
- AC5: 当已有记忆与当前对话明显矛盾时，LLM 应调用 memory_delete
- AC6: 提取失败（LLM 错误、网络超时等）不应阻塞主对话
- AC7: 记忆目录不再出现无意义的碎片化笔记
