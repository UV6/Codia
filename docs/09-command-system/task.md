# 命令注册与分发机制 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/command/types.ts` | 所有类型定义 |
| 新建 | `src/command/parser.ts` | parseCommand 纯函数 |
| 新建 | `src/command/registry.ts` | CommandRegistry 类 |
| 新建 | `src/command/dispatcher.ts` | dispatch 函数 |
| 新建 | `src/command/builtin/help.ts` | /help 命令 |
| 新建 | `src/command/builtin/compact.ts` | /compact 命令 |
| 新建 | `src/command/builtin/clear.ts` | /clear 命令 |
| 新建 | `src/command/builtin/plan.ts` | /plan 命令 |
| 新建 | `src/command/builtin/do.ts` | /do 命令 |
| 新建 | `src/command/builtin/session.ts` | /session 命令 |
| 新建 | `src/command/builtin/memory.ts` | /memory 命令 |
| 新建 | `src/command/builtin/permission.ts` | /permission 命令 |
| 新建 | `src/command/builtin/status.ts` | /status 命令 |
| 新建 | `src/command/builtin/review.ts` | /review 命令 |
| 新建 | `src/command/builtin/index.ts` | 汇总导出 builtinCommands |
| 新建 | `src/command/__tests__/parser.test.ts` | parseCommand 测试 |
| 新建 | `src/command/__tests__/registry.test.ts` | CommandRegistry 测试 |
| 新建 | `src/command/__tests__/dispatcher.test.ts` | dispatch 测试 |
| 修改 | `src/tui/status-bar.tsx` | 增加 mode prop，显示 [DEFAULT]/[PLAN] |
| 修改 | `src/tui/input-box.tsx` | 增加 Tab 补全和 registry prop |
| 修改 | `src/tui/app.tsx` | 集成 CommandRegistry、UIContext、分流器 |
| 修改 | `src/chat/chat-service.ts` | 移除 if-else 命令处理，保留模式切换方法 |

## T1: 定义命令系统类型

**文件：** `src/command/types.ts`
**依赖：** 无
**步骤：**
1. 定义 `CommandType = "local" | "ui" | "prompt"`
2. 定义 `CommandHandler = (args: string, ui: UIContext) => void`
3. 定义 `CommandDef` 接口（name, aliases?, description, usage?, type, argsHint?, hidden?, handler）
4. 定义 `ParseResult` 接口（isCommand, name, args）
5. 定义 `UIContext` 接口（showMessage, sendUserMessage, setMode, getMode, getTokenUsage, refreshStatus）
6. 定义 `CompletionResult` 类型（single | multiple | none）

**验证：** `pnpm exec tsc --noEmit` 类型检查通过

## T2: 实现命令解析器

**文件：** `src/command/parser.ts`
**依赖：** T1
**步骤：**
1. 实现 `parseCommand(input: string): ParseResult`
2. 不以 `/` 开头 → `{ isCommand: false, name: "", args: "" }`
3. 去掉 `/`，找第一个空格位置
4. 空格前为命令名（转小写），空格后为 args（trim）
5. 仅 `/`（命令名为空）→ `{ isCommand: false, name: "", args: "" }`

**验证：** 写 T16 单元测试验证各场景

## T3: 实现命令注册中心

**文件：** `src/command/registry.ts`
**依赖：** T1
**步骤：**
1. 实现 `CommandRegistry` 类
2. 内部 `Map<string, CommandDef>`（主名）和 `Map<string, string>`（别名→主名）
3. `register(cmd)`: 检查名称冲突 → 检查别名冲突 → 写入两个 Map。任何冲突 throw Error
4. `get(nameOrAlias)`: 先查主 Map，再查别名 Map，返回 CommandDef 或 undefined
5. `getAll()`: 返回所有非隐藏命令的 CommandDef 数组
6. `getMatches(prefix)`: 对主名和别名做前缀匹配，去重，排除隐藏命令

**验证：** 写 T17 单元测试验证注册、查找、冲突检测、前缀匹配

## T4: 实现命令分发器

**文件：** `src/command/dispatcher.ts`
**依赖：** T1
**步骤：**
1. 实现 `dispatch(cmd: CommandDef, args: string, ui: UIContext): void`
2. `local` 和 `ui` 类型：直接调 `cmd.handler(args, ui)`
3. `prompt` 类型：构建提示词文本，调 `ui.sendUserMessage(text)`
4. 提示词构建规则：`[命令描述] args` 格式，如 review 命令将 `/review` 转为预设的代码审查提示词

**验证：** 写 T18 单元测试，mock UIContext 验证各类型的分发行为

## T5: 实现 /help 命令

**文件：** `src/command/builtin/help.ts`
**依赖：** T1
**步骤：**
1. 导出 `helpCommand: CommandDef`
2. 类型 `local`，别名 `["h", "?"]`
3. handler 调用 `ui.showMessage()` 展示所有可见命令列表（通过闭包或参数访问 registry，用 args 参数定位单个命令详情）

**验证：** 类型检查通过，handler 签名正确

## T6: 实现 /compact 命令

**文件：** `src/command/builtin/compact.ts`
**依赖：** T1
**步骤：**
1. 导出 `compactCommand: CommandDef`
2. 类型 `local`
3. handler 调 `ui.triggerCompact()` 触发上下文压缩

**验证：** 类型检查通过

## T7: 实现 /clear 命令

**文件：** `src/command/builtin/clear.ts`
**依赖：** T1
**步骤：**
1. 导出 `clearCommand: CommandDef`
2. 类型 `ui`，别名 `["cls"]`
3. handler 调 `ui.clearMessages()` 清空消息列表

**验证：** 类型检查通过

## T8: 实现 /plan 命令

**文件：** `src/command/builtin/plan.ts`
**依赖：** T1
**步骤：**
1. 导出 `planCommand: CommandDef`
2. 类型 `ui`
3. handler：`ui.setMode("plan")`，可选将 args 作为提示词注入（如 `/plan 重构认证` → 设置 plan 模式 + 注入消息）

**验证：** 类型检查通过

## T9: 实现 /do 命令

**文件：** `src/command/builtin/do.ts`
**依赖：** T1
**步骤：**
1. 导出 `doCommand: CommandDef`
2. 类型 `ui`
3. handler：`ui.setMode("full")`

**验证：** 类型检查通过

## T10: 实现 /session 命令

**文件：** `src/command/builtin/session.ts`
**依赖：** T1
**步骤：**
1. 导出 `sessionCommand: CommandDef`
2. 类型 `local`
3. handler 调 `ui.showMessage()` 展示当前会话路径、消息数等信息

**验证：** 类型检查通过

## T11: 实现 /memory 命令

**文件：** `src/command/builtin/memory.ts`
**依赖：** T1
**步骤：**
1. 导出 `memoryCommand: CommandDef`
2. 类型 `local`
3. handler 调 `ui.showMessage()` 展示记忆存储状态

**验证：** 类型检查通过

## T12: 实现 /permission 命令

**文件：** `src/command/builtin/permission.ts`
**依赖：** T1
**步骤：**
1. 导出 `permissionCommand: CommandDef`
2. 类型 `local`
3. handler 调 `ui.showMessage()` 展示当前权限模式

**验证：** 类型检查通过

## T13: 实现 /status 命令

**文件：** `src/command/builtin/status.ts`
**依赖：** T1
**步骤：**
1. 导出 `statusCommand: CommandDef`
2. 类型 `local`
3. handler 调 `ui.getTokenUsage()` 和 `ui.getMode()`，通过 `ui.showMessage()` 展示汇总信息

**验证：** 类型检查通过

## T14: 实现 /review 命令

**文件：** `src/command/builtin/review.ts`
**依赖：** T1
**步骤：**
1. 导出 `reviewCommand: CommandDef`
2. 类型 `prompt`
3. 设置 `promptText` 为预设的代码审查提示词
4. handler 留空（prompt 型由 dispatcher 直接取 promptText 注入）

**验证：** 类型检查通过

## T15: 汇总内置命令

**文件：** `src/command/builtin/index.ts`
**依赖：** T5-T14
**步骤：**
1. 导入全部十个命令
2. 导出 `builtinCommands: CommandDef[]` 数组

**验证：** `pnpm exec tsc --noEmit` 通过

## T16: 编写 parser 单元测试

**文件：** `src/command/__tests__/parser.test.ts`
**依赖：** T2
**步骤：**
1. 测试 `/help` → `{ isCommand: true, name: "help", args: "" }`
2. 测试 `/plan 重构认证` → `{ isCommand: true, name: "plan", args: "重构认证" }`
3. 测试 `/Help` → `{ isCommand: true, name: "help", args: "" }`
4. 测试 `hello` → `{ isCommand: false }`
5. 测试 `/` → `{ isCommand: false }`
6. 测试空字符串 → `{ isCommand: false }`

**验证：** `pnpm test` 本文件通过

## T17: 编写 registry 单元测试

**文件：** `src/command/__tests__/registry.test.ts`
**依赖：** T3
**步骤：**
1. 测试注册和按名称查找
2. 测试别名查找
3. 测试名称冲突 throw
4. 测试别名与名称冲突 throw
5. 测试别名与别名冲突 throw
6. 测试 getMatches 前缀匹配（单匹配、多匹配、无匹配）
7. 测试 getMatches 不返回隐藏命令
8. 测试 getAll 不返回隐藏命令

**验证：** `pnpm test` 本文件通过

## T18: 编写 dispatcher 单元测试

**文件：** `src/command/__tests__/dispatcher.test.ts`
**依赖：** T4
**步骤：**
1. Mock UIContext
2. 测试 local 型命令直接执行 handler，不调 sendUserMessage
3. 测试 ui 型命令直接执行 handler，不调 sendUserMessage
4. 测试 prompt 型命令调 sendUserMessage，不调 handler，且 sendUserMessage 收到的文本来自 cmd.promptText
5. 测试 prompt 型命令带 args 时，注入的文本包含 promptText 和参数

**验证：** `pnpm test` 本文件通过

## T19: 修改 StatusBar 增加模式标记

**文件：** `src/tui/status-bar.tsx`
**依赖：** T1
**步骤：**
1. 在 StatusBarProps 增加 `mode: "full" | "plan"` prop
2. 渲染时在模型名前显示 `[PLAN]` 或 `[DEFAULT]`
3. 样式用 dimColor，与现有风格一致

**验证：** 类型检查通过，视觉确认状态栏显示模式标记

## T20: 修改 InputBox 增加 Tab 补全

**文件：** `src/tui/input-box.tsx`
**依赖：** T1, T3
**步骤：**
1. 在 InputBoxProps 增加可选 `registry?: CommandRegistry` prop
2. 使用 `useInput` hook 监听 Tab 键
3. Tab 时取当前 value，调 `registry.getMatches(prefix)` 做前缀匹配
4. 单匹配 → `setValue(completion)`
5. 多匹配 → 调 `onShowCompletions?.(matches)`（新增 prop）或直接在输入框下方显示匹配列表
6. 非 `/` 开头时 Tab 不触发补全
7. 界面方案：多匹配时在 InputBox 下方渲染一个候选列表

**验证：** 类型检查通过，手动测试 Tab 补全行为

## T21: 修改 App 集成命令系统

**文件：** `src/tui/app.tsx`
**依赖：** T2, T3, T4, T15, T19, T20
**步骤：**
1. 导入 CommandRegistry, parseCommand, dispatch, builtinCommands
2. 用 `useMemo` 创建 CommandRegistry 实例并注册 builtinCommands（仅首次）
3. 用 `useMemo` 创建 UIContext 实例，桥接到 App state 和 service
4. 在 `handleSubmit` 入口调用 `parseCommand(text)`：
   - 是命令 → `dispatch(cmd, args, uiContext)`，return
   - 未命中 → `uiContext.showMessage('未知命令，输入 /help 查看帮助', 'warning')`，return
   - 非命令 → 继续现有 AI 对话逻辑
5. 给 StatusBar 传 mode prop
6. 给 InputBox 传 registry prop
7. UIContext 实现要点：
   - `showMessage`: 用 state 在界面临时展示消息（或追加 system 消息到 messages）
   - `sendUserMessage`: 调用 handleSubmit 逻辑（需处理递归调用问题——prompt 型命令的 sendUserMessage 应该直接走 AI 路径，不再经分流器）
   - `setMode`: 调 service 方法 + 触发 StatusBar 刷新
   - `getMode`: 读 service.currentMode
   - `getTokenUsage`: 读 usage state
   - `refreshStatus`: 触发 state 更新

**验证：** `pnpm exec tsc --noEmit` 编译通过

## T22: 清理 ChatService

**文件：** `src/chat/chat-service.ts`
**依赖：** T21
**步骤：**
1. 移除 `isPlanCommand`、`isDoCommand`、`extractPlanMessage` 的调用逻辑
2. 移除 `isCompressCommand`、`isPermissionDefaultCommand`、`isPermissionAcceptsEditCommand` 和对应 if-else 分支
3. `sendMessage` 开头不再做命令检测，直接处理为普通消息
4. 保留 `setMode(mode)`、`get currentMode` 等对外方法供 UIContext 调用
5. 确认 `plan-mode.ts` 中的 `PLAN_MODE_PROMPT` 和 `filterReadOnlyTools` 仍被引用（AgentLoop 在用），不要删除文件

**验证：** `pnpm exec tsc --noEmit` 编译通过，`pnpm test` 全部通过

## 执行顺序

```
T1 ──→ T2 ──→ T16 (parser 测试)
  │
  ├──→ T3 ──→ T17 (registry 测试)
  │
  ├──→ T4 ──→ T18 (dispatcher 测试)
  │
  ├──→ T5 ──┐
  ├──→ T6 ──┤
  ├──→ T7 ──┤
  ├──→ T8 ──┤
  ├──→ T9 ──┼──→ T15 (汇总)
  ├──→ T10 ─┤
  ├──→ T11 ─┤
  ├──→ T12 ─┤
  ├──→ T13 ─┤
  └──→ T14 ─┘
                │
                ▼
        T19 ──→ T20 ──→ T21 ──→ T22
       (status) (input)  (app)   (cleanup)
```
