# 命令注册与分发机制 Plan

## 架构概览

整个命令系统分为六个模块，职责清晰、依赖单向：

```
用户输入 → InputBox.handleSubmit
              │
              ▼
        parseCommand(input)
              │
         ┌────┴────┐
         │ 是命令？  │
         └────┬────┘
              │ 是
              ▼
        CommandRegistry.get(name)
              │
         ┌────┴────┐
         │ 命中？    │
         └────┬────┘
              │ 是                          │ 否 → 显示 /help 引导
              ▼
        dispatch(cmd, args, uiContext)
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
  local      ui      prompt
 直接执行   操纵界面   注入对话
              │
              ▼
        非命令输入 → ChatService.sendMessage()
```

**模块划分：**

- **CommandParser**：纯函数，从输入文本中提取命令名和参数，判断是否为命令
- **CommandRegistry**：命令注册中心，管理元数据和生命周期，启动阶段注册所有命令并做冲突检测
- **CommandDispatcher**：根据命令类型（local/ui/prompt）走不同执行路径
- **UIContext（接口）**：命令与 TUI 的抽象边界，命令只依赖此接口，不感知 Ink/React
- **Builtin Commands**：十个内置命令的实现文件，每个文件导出一个 `CommandDef` 对象
- **App 层集成**：在 `app.tsx` 的 `handleSubmit` 入口组装 UIContext 实例，调分流器

## 核心数据结构

### CommandType

```typescript
type CommandType = "local" | "ui" | "prompt";
```

### CommandDef

```typescript
interface CommandDef {
  name: string;            // 命令名（不含 /），小写，如 "help"
  aliases?: string[];      // 别名列表，不含 /，如 ["h", "?"]
  description: string;     // 简短描述，如 "显示帮助信息"
  usage?: string;          // 用法示例，如 "/help [command]"
  type: CommandType;       // 执行模式
  argsHint?: string;       // 参数提示，如 "[command]"
  hidden?: boolean;        // 是否隐藏（不参与补全和 help 列表）
  promptText?: string;     // prompt 型命令的预设提示词（仅 prompt 型需要）
  handler: CommandHandler; // 处理函数（prompt 型可留空）
}
```

### CommandHandler

```typescript
type CommandHandler = (args: string, ui: UIContext) => void;
```

- `args`：命令名之后的全部文本（已 trim），可能为空字符串
- `ui`：界面控制接口，命令通过它操作界面或注入对话
- 返回 void：local/ui 型同步执行；prompt 型通过 `ui.sendUserMessage()` 异步注入

### ParseResult

```typescript
interface ParseResult {
  isCommand: boolean;
  name: string;    // 命令名（小写），非命令时为空
  args: string;    // 参数字符串，非命令时为空
}
```

### UIContext（接口）

```typescript
interface UIContext {
  showMessage(text: string, type: "info" | "warning" | "error"): void;
  sendUserMessage(text: string): void;       // 直接调 ChatService.sendMessage()，绕过命令分流
  clearMessages(): void;                     // 清空聊天消息列表
  setMode(mode: "full" | "plan"): void;
  getMode(): "full" | "plan";
  getTokenUsage(): { inputTokens: number; outputTokens: number } | null;
  triggerCompact(): void;                    // 手动触发上下文压缩
  refreshStatus(): void;
}
```

### CommandRegistry

```typescript
class CommandRegistry {
  register(cmd: CommandDef): void;           // 注册，冲突时 throw
  get(nameOrAlias: string): CommandDef | undefined;
  getAll(): CommandDef[];                    // 不含隐藏命令
  getMatches(prefix: string): CommandDef[];  // 前缀匹配，用于补全
}
```

### CompletionResult（补全结果）

```typescript
type CompletionResult =
  | { type: "single"; completion: string }    // 单匹配，直接补全
  | { type: "multiple"; matches: string[] }   // 多匹配，弹菜单
  | { type: "none" };                         // 无匹配
```

## 模块设计

### M1: CommandParser（`src/command/parser.ts`）

**职责：** 从原始输入文本解析命令名和参数，判断是否为命令

**对外接口：**
- `parseCommand(input: string): ParseResult`

**逻辑：**
1. 检查是否以 `/` 开头 → 否 → `{ isCommand: false, name: "", args: "" }`
2. 去掉 `/`，找第一个空格位置
3. 空格前为命令名（转小写），空格后为 args（trim）
4. 命令名为空（输入仅 `/`）→ 视为非命令，或返回特殊标记由调用方处理

**依赖：** 无

### M2: CommandRegistry（`src/command/registry.ts`）

**职责：** 命令注册、冲突检测、查找、补全匹配

**对外接口：**
- `register(cmd: CommandDef): void`
- `get(nameOrAlias: string): CommandDef | undefined`
- `getAll(): CommandDef[]`
- `getMatches(prefix: string): CommandDef[]`

**内部实现：**
- 用一个 `Map<string, CommandDef>` 存储，key 为命令名
- 用一个 `Map<string, string>` 存储别名到命令名的映射
- `register` 时校验：aliases 数组自身不能有重复项或空字符串；检查 name 是否已在 Map 中；检查每个 alias 是否与已有 name 或别名冲突，任何冲突则 throw
- `get` 先查主名 Map，再查别名 Map
- `getMatches` 对 name 和别名做前缀匹配，返回去重后的 CommandDef 列表，排除隐藏命令

**依赖：** CommandDef

### M3: CommandDispatcher（`src/command/dispatcher.ts`）

**职责：** 根据命令类型执行不同路径

**对外接口：**
- `dispatch(cmd: CommandDef, args: string, ui: UIContext): void`

**逻辑：**
```typescript
switch (cmd.type) {
  case "local":
  case "ui":
    cmd.handler(args, ui);     // 同步执行
    break;
  case "prompt":
    // prompt 型不调 handler，直接用 CommandDef.promptText
    const text = cmd.promptText
      ? args ? `${cmd.promptText}\n\n参数: ${args}` : cmd.promptText
      : args;
    ui.sendUserMessage(text);  // 注入对话（绕过命令分流器）
    break;
}
```

**依赖：** CommandDef, UIContext

### M4: 内置命令（`src/command/builtin/`）

每个命令一个文件，导出 `CommandDef` 对象。依赖 UIContext 接口但不依赖具体实现。

| 文件 | 命令 | 类型 |
|------|------|------|
| `help.ts` | /help | local |
| `compact.ts` | /compact | local |
| `clear.ts` | /clear | ui |
| `plan.ts` | /plan | ui |
| `do.ts` | /do | ui |
| `session.ts` | /session | local |
| `memory.ts` | /memory | local |
| `permission.ts` | /permission | local |
| `status.ts` | /status | local |
| `review.ts` | /review | prompt |

另有一个 `index.ts` 汇总导出所有命令对象的数组，供 `ChatService` 或 `App` 在初始化时一次性注册。

**依赖：** CommandDef, UIContext

### M5: UIContext 实现（在 `app.tsx` 中）

**职责：** 在 App 组件内创建 UIContext 实例，把接口方法桥接到 Ink state 和 ChatService

**实现方式：**
- `showMessage` → 通过 state 在界面显示一条临时消息（追加为 role: "system" 消息到 messages 列表）
- `sendUserMessage` → 直接调用 `ChatService.sendMessage(text)`，**不经过 handleSubmit 的命令分流器**，避免 prompt 型命令注入的文本被二次解析为命令
- `clearMessages` → 调用 `setMessages([])` 清空消息列表 state
- `setMode` → 调用 `service.setMode(mode)` + 更新 mode state 触发 StatusBar 刷新
- `getMode` → 读取 `service.currentMode`
- `getTokenUsage` → 读取 App 的 `usage` state
- `triggerCompact` → 调用 `service.compact()` 或 `service.sendMessage("/compact")`
- `refreshStatus` → 触发 state 更新

不单独建文件，直接在 `app.tsx` 中用 `useMemo` 或 `useCallback` 创建对象传入分流器。

### M6: Tab 补全（在 `InputBox` 中）

**职责：** 监听 Tab 键，调用 CommandRegistry 做前缀匹配，更新输入框文本

**修改范围：** 扩展 `InputBox` 组件，增加 `registry?: CommandRegistry` prop 和 Tab 按键处理

## 文件组织

```
src/
├── command/
│   ├── types.ts          — CommandType, CommandDef, CommandHandler, ParseResult, UIContext, CompletionResult
│   ├── parser.ts         — parseCommand()
│   ├── registry.ts       — CommandRegistry 类
│   ├── dispatcher.ts     — dispatch()
│   ├── builtin/
│   │   ├── index.ts      — 汇总导出 builtinCommands 数组
│   │   ├── help.ts       — /help
│   │   ├── compact.ts    — /compact
│   │   ├── clear.ts      — /clear
│   │   ├── plan.ts       — /plan
│   │   ├── do.ts         — /do
│   │   ├── session.ts    — /session
│   │   ├── memory.ts     — /memory
│   │   ├── permission.ts — /permission
│   │   ├── status.ts     — /status
│   │   └── review.ts     — /review
│   └── __tests__/
│       ├── parser.test.ts
│       ├── registry.test.ts
│       └── dispatcher.test.ts
├── tui/
│   ├── app.tsx           — 创建 UIContext 实例，集成 CommandRegistry 和分流器
│   ├── input-box.tsx     — 增加 Tab 补全逻辑和 registry prop
│   └── status-bar.tsx    — 增加 mode prop，显示 [DEFAULT]/[PLAN]
└── chat/
    └── chat-service.ts   — 移除现有 if-else 命令处理，保留模式切换方法供 UIContext.setMode 调用
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 命令处理函数签名 | `(args: string, ui: UIContext) => void` | 简洁够用，prompt 型通过 `ui.sendUserMessage` 注入对话，不需要返回值 |
| 冲突检测时机 | `register()` 时立即 throw | 满足 N1，启动阶段暴露问题，fail-fast |
| 别名存储方式 | 独立 `Map<alias, name>` | 查找 O(1)，冲突检测简单，不增加 CommandDef 复杂度 |
| UIContext 实现位置 | `app.tsx` 中用 useMemo 创建 | 职责归属清晰（TUI 层），避免引入额外抽象层，符合项目当前简单 Ink 架构 |
| parser 设计 | 导出纯函数而非类 | 无状态、无依赖，测试最简单 |
| Tab 补全位置 | InputBox 组件内 | 补全是输入框行为，属于 UI 交互而非命令系统逻辑 |
| ChatService 改动范围 | 只保留 setMode/getMode/permissionMode 等状态，删除 if-else 命令检测 | 命令分发上移到 App 层，ChatService 专注对话 |
| 现有 /compress, /default, /acceptsEdit 处理 | 作为本地命令重新实现，移出 sendMessage | 统一入口，不搞两套命令处理 |
