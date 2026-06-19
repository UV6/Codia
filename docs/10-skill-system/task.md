# Skill 系统 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/skill/types.ts` | SkillFrontmatter、Skill、SkillSummary、SkillDiagnostic、SkillLoadResult |
| 新建 | `src/skill/loader.ts` | 三层目录扫描、YAML frontmatter 解析、优先级去重、单文件/目录型区分 |
| 新建 | `src/skill/registry.ts` | Skill 摘要管理、激活/反激活/清空、工具白名单计算与校验 |
| 新建 | `src/skill/activator.ts` | loadSkill、loadSkillByIntent、参数占位符替换 |
| 新建 | `src/skill/builtin/commit.md` | 内置 commit Skill（inline） |
| 新建 | `src/skill/builtin/review.md` | 内置 review Skill（fork） |
| 新建 | `src/skill/builtin/test.md` | 内置 test Skill（inline） |
| 新建 | `src/tool/tools/load-skill.ts` | LoadSkill 系统工具定义 |
| 新建 | `src/__tests__/skill/loader.test.ts` | loader 单元测试 |
| 新建 | `src/__tests__/skill/registry.test.ts` | registry 单元测试 |
| 新建 | `src/__tests__/skill/activator.test.ts` | activator 单元测试 |
| 修改 | `src/tool/registry.ts` | 注册 LoadSkill 工具 |
| 修改 | `src/bootstrap/context-builder.ts` | 注入 Skill 摘要和激活正文 |
| 修改 | `src/bootstrap/types.ts` | 扩展 BootstrapContext，增加 skillSummaries 和 activeSkillBodies 字段 |
| 修改 | `src/command/builtin/index.ts` | 从 Skill 列表动态生成命令，移除被替换的旧 review 命令 |
| 修改 | `src/tui/app.tsx` | 清空对话时清除 Skill 激活；启动时初始化 Skill 系统 |
| 修改 | `src/chat/chat-service.ts` | 接收 Skill 摘要和激活正文，注入 system prompt |

## T1: 定义核心类型

**文件：** `src/skill/types.ts`
**依赖：** 无
**步骤：**
1. 定义 `SkillMode` 类型：`"inline" | "fork"`
2. 定义 `SkillSource` 类型：`"builtin" | "user" | "project"`
3. 定义 `SkillFrontmatter` 接口：name（必填）、description（必填）、mode（必填）、allowedTools（可选 string[]）、historyRounds（可选 number）、model（可选 string）
4. 定义 `Skill` 接口：source、dir、frontmatter、body
5. 定义 `SkillSummary` 接口：name、description、source
6. 定义 `SkillDiagnostic` 接口：filePath、level（`"error" | "warning"`）、message
7. 定义 `SkillLoadResult` 接口：name、mode、body、resources（string[]）

**验证：** `npx tsc --noEmit src/skill/types.ts` 编译通过

## T2: 实现 Skill 加载器

**文件：** `src/skill/loader.ts`
**依赖：** T1
**步骤：**
1. 实现 `getDirs(projectRoot: string)` — 返回三层 Skill 目录路径（内置 `<codia>/skills/builtin/`、用户 `~/.codia/skills/`、项目 `<root>/.codia/skills/`）
2. 实现 `parseSkillFile(filePath: string): Skill | null` — 读取文件，用 `yaml` 包的 `parse` 提取 `---` 分隔的 frontmatter，校验必填字段（name、description、mode），失败返回 null。正文为 frontmatter 之后的内容
3. 实现 `scanDir(dir: string, source: SkillSource): { skills: Skill[]; diagnostics: SkillDiagnostic[] }` — 扫描单层目录：
   - 遍历 `.md` 文件（单文件 Skill）
   - 遍历子目录中带 `skill.md` 的（目录型 Skill），记录 dir 字段
   - 每个文件用 `parseSkillFile` 解析，失败时生成 warning 级 SkillDiagnostic 并跳过
   - 单文件 Skill 和目录型 Skill 分别处理：单文件用文件名（去 .md）作为 name 兜底，目录型用子目录名
4. 实现 `scanAll(projectRoot: string): { skills: Skill[]; diagnostics: SkillDiagnostic[] }` — 调用 `scanDir` 扫描三层，按内置→用户→项目的顺序以 name 去重覆盖（后扫的覆盖先扫的），累积诊断信息

**验证：** `npx tsc --noEmit src/skill/loader.ts` 编译通过

## T3: 实现 Skill 注册中心

**文件：** `src/skill/registry.ts`
**依赖：** T1
**步骤：**
1. 实现 `SkillRegistry` 类：
   - `setSummaries(summaries: SkillSummary[]): void` — 设置摘要列表
   - `getSummaries(): SkillSummary[]` — 返回摘要
   - `activate(skill: Skill, args?: string[]): SkillLoadResult` — 将 Skill 加入激活 Map（name → Skill），做 `{{arg1}}`→`args[0]` 等参数替换，返回 SkillLoadResult
   - `deactivate(name: string): void` — 从激活 Map 移除
   - `clear(): void` — 清空激活 Map
   - `getActiveSkillBodies(): string[]` — 返回所有激活 Skill 的正文（经参数替换后）
   - `getActiveSummaries(): string[]` — 返回 `[skill-name] mode 激活中` 格式的状态行
   - `getEffectiveAllowedTools(allTools: string[]): string[]` — 计算有效工具：取所有激活 Skill 的 allowedTools 并集；若任一 Skill 无 allowedTools 限制则返回全部 allTools
   - `validateAllowedTools(allToolNames: Set<string>): SkillDiagnostic[]` — 遍历摘要中的 Skill，校验每个的 allowedTools 引用的工具名是否在 allToolNames 中存在，不存在生成 error 级诊断
2. 参数替换逻辑：用正则 `\{\{(\w+)\}\}` 匹配占位符，按 `args` 数组索引替换（`{{arg1}}` 替换为 `args[0]`，`{{arg2}}` 替换为 `args[1]`，以此类推）

**验证：** `npx tsc --noEmit src/skill/registry.ts` 编译通过

## T4: 实现 Skill 激活协调器

**文件：** `src/skill/activator.ts`
**依赖：** T2、T3
**步骤：**
1. 实现 `createActivator(registry: SkillRegistry, projectRoot: string)` 工厂函数，返回 `SkillActivator` 对象
2. `loadSkill(name: string, args?: string[]): SkillLoadResult | null` — 调 `Loader.loadOne` 获取 Skill，调 `registry.activate` 激活，返回 SkillLoadResult
3. `loadSkillByIntent(task: string): SkillLoadResult | null` — 遍历 `registry.getSummaries()`，用 task 文本匹配 name 和 description（简单包含匹配），命中的第一个自动调用 `loadSkill`（不带 args）；未命中返回 null
4. `getAvailableResources(name: string): string[]` — 对目录型 Skill，列出其 `reference/`、`script/`、`example/` 子目录下的文件路径

**验证：** `npx tsc --noEmit src/skill/activator.ts` 编译通过

## T5: 实现 LoadSkill 系统工具

**文件：** `src/tool/tools/load-skill.ts`
**依赖：** T4、T1（Tool 类型）
**步骤：**
1. 定义 `LoadSkillTool` 实现 `Tool` 接口：
   - `name`: `"LoadSkill"`
   - `description`: `"按需加载一个 Skill 的完整指令和专属工具。传入 Skill 名字，返回 SOP 正文。Skill 加载后其指令会钉在上下文顶部。"`
   - `inputSchema`: 包含 `name`（必填，Skill 名）和 `args`（可选，参数字符串，空格分隔）
   - `execute`: 解析参数，调用 `activator.loadSkill`，返回结果 JSON 字符串
2. 工具类型设为 `"search"`，readOnly 为 true
3. 写出 `loadSkillTool` 单例 export

**验证：** `npx tsc --noEmit src/tool/tools/load-skill.ts` 编译通过

## T6: 编写内置 Skill 文件 — commit

**文件：** `src/skill/builtin/commit.md`
**依赖：** 无
**步骤：**
1. YAML frontmatter：`name: commit`、`description: 分析代码变更并生成规范提交`、`mode: inline`、`allowedTools: ["Bash"]`
2. 正文 SOP：
   - 步骤1：运行 `git status` 了解变更概览
   - 步骤2：运行 `git diff` 和 `git diff --staged` 获取详细变更
   - 步骤3：分析变更内容，生成 conventional commit message（格式 `type(scope): description`）
   - 步骤4：逐文件 `git add <file>`（不用 `git add -A`）
   - 步骤5：`git commit -m "<message>"`
   - 变更超过 10 个文件时主动建议拆分为多个提交

**验证：** 文件格式正确，frontmatter 可被 YAML 解析

## T7: 编写内置 Skill 文件 — review

**文件：** `src/skill/builtin/review.md`
**依赖：** 无
**步骤：**
1. YAML frontmatter：`name: review`、`description: 在独立上下文中审查代码变更，五维度客观评估`、`mode: fork`、`historyRounds: 3`
2. 正文 SOP：
   - 你是代码审查专家，在独立对话中审查代码变更
   - 五个维度：逻辑正确性、安全性、性能、代码风格、可维护性
   - 严重程度分级：Critical / Warning / Info
   - 审查完毕后输出结构化报告
   - 最后将摘要回流到主对话

**验证：** 文件格式正确，frontmatter 可被 YAML 解析

## T8: 编写内置 Skill 文件 — test

**文件：** `src/skill/builtin/test.md`
**依赖：** 无
**步骤：**
1. YAML frontmatter：`name: test`、`description: 运行测试并智能分析失败原因`、`mode: inline`
2. 正文 SOP：
   - 步骤1：检测项目类型和测试框架
   - 步骤2：运行测试命令，收集输出
   - 步骤3：分析输出，区分代码 bug 导致的失败 vs 测试本身写错导致的失败
   - 步骤4：全部通过时报告覆盖率，指出可能的遗漏场景
   - 步骤5：如有失败，指出根因和修复方向

**验证：** 文件格式正确，frontmatter 可被 YAML 解析

## T9: 注册 LoadSkill 工具并调整 ToolRegistry

**文件：** `src/tool/registry.ts`
**依赖：** T5
**步骤：**
1. 在 `ToolRegistry` 中新增 `getToolNames(): string[]` 方法 — 返回所有已注册工具名
2. 新增 `getMetasWithFilter(allowedNames?: string[]): ToolMeta[]` 方法 — 当 allowedNames 存在时只返回白名单内工具的 metas，否则返回全部

**验证：** `npx tsc --noEmit src/tool/registry.ts` 编译通过

## T10: 扩展 BootstrapContext 类型

**文件：** `src/bootstrap/types.ts`
**依赖：** T1
**步骤：**
1. 在 `BootstrapContext` 接口中新增两个字段：
   - `skillSummaries: string` — 阶段一 Skill 摘要文本（注入 prompt）
   - `activeSkillBodies: string` — 已激活 Skill 正文文本（注入 prompt 顶部）

**验证：** `npx tsc --noEmit src/bootstrap/types.ts` 编译通过

## T11: 集成 Skill 系统到 ContextBuilder

**文件：** `src/bootstrap/context-builder.ts`
**依赖：** T10、T2、T3
**步骤：**
1. 在 `buildNewSessionContext` 中新增：
   - 调用 `scanAll(projectRoot)` 获取 skills 和 diagnostics
   - 创建 `SkillRegistry` 实例，调用 `setSummaries`
   - 生成 skillSummaries 文本：`## 可用 Skill\n\n` + 每个 Skill 一行 `- **/name**: description`
   - 校验 allowedTools：`registry.validateAllowedTools(new Set(allToolNames))`
   - 将所有 Skill 相关诊断合并到 `diag.entries`
   - 返回 `skillSummaries` 文本和空的 `activeSkillBodies`
2. `BootstrapContext` 中新增字段后，确保 `buildResumeContext` 也传递这些字段

**验证：** `npx tsc --noEmit src/bootstrap/context-builder.ts` 编译通过

## T12: 集成 Skill 命令注册

**文件：** `src/command/builtin/index.ts`
**依赖：** T1
**步骤：**
1. 将从 Skill 列表生成命令的逻辑封装为函数 `buildSkillCommands(skills: SkillSummary[]): CommandDef[]`
2. 每个 Skill 生成一个 `CommandDef`：
   - `name`: skill.name
   - `description`: skill.description
   - `type`: `"prompt"`
   - `promptText`: `请调用 LoadSkill 工具，加载 "${name}" Skill。{{args}}`
   - `handler`: 空函数
3. 移出现有的硬编码 `reviewCommand`（review 命令现在由 Skill 系统生成）
4. `builtinCommands` 改为函数调用结果，同时保留非 Skill 命令（help、compact、clear 等）

**验证：** `npx tsc --noEmit src/command/builtin/index.ts` 编译通过

## T13: 集成 Skill 系统到 ChatService

**文件：** `src/chat/chat-service.ts`
**依赖：** T10、T11
**步骤：**
1. 在 `ChatService` 中新增字段：`private skillRegistry: SkillRegistry`、`private skillActivator: SkillActivator`
2. 构造函数中：接收 `BootstrapContext` 的 `skillSummaries` 和 `activeSkillBodies` 字段，存入实例
3. 在 `SystemPromptBuilder` 中注入：
   - `skillSummaries` 作为独立 Section（priority 略低于核心指令）
   - `activeSkillBodies` 作为最高 priority Section（钉在顶部）
4. 新增 `getSkillRegistry(): SkillRegistry` 公开方法
5. 每轮对话重建 system prompt 时同步激活 Skill 的正文
6. 将 LoadSkill 工具注册到 ToolRegistry：`this.registry.register(loadSkillTool)`（在六个核心工具之后）
7. LoadSkill 工具的 execute 回调需要能访问 `skillActivator`——在注册时注入

**验证：** `npx tsc --noEmit src/chat/chat-service.ts` 编译通过

## T14: 集成 Skill 系统到 App（清空对话 + 启动初始化）

**文件：** `src/tui/app.tsx`
**依赖：** T12、T13
**步骤：**
1. 从 `service` 获取 `skillRegistry` 引用
2. 在 `handleSubmit` 的命令分流中：对于 prompt 型命令，将 args 通过 `sendUserMessage` 的文本传入
3. 在 `clearMessages` 调用时同步调用 `skillRegistry.clear()` 清除激活
4. 在 App 启动时：`service` 初始化完成后，调用 `registry` 注册 Skill 生成的命令

**验证：** `npx tsc --noEmit src/tui/app.tsx` 编译通过

## T15: 编写 loader 单元测试

**文件：** `src/__tests__/skill/loader.test.ts`
**依赖：** T2
**步骤：**
1. 用 vitest 的 `vi.mock` mock fs 操作，准备临时目录结构
2. 测试用例：
   - 单文件 Skill 解析成功
   - 目录型 Skill 解析成功（取 `skill.md` 入口）
   - YAML frontmatter 格式错误时跳过并产生诊断
   - 缺少必填字段时跳过并产生诊断
   - 三层优先级覆盖：项目 Skill 覆盖同名用户 Skill
   - 空目录不报错，返回空列表
   - 支持 `{{arg1}}` 占位符出现在正文中

**验证：** `pnpm test src/__tests__/skill/loader.test.ts` 全部通过

## T16: 编写 registry 单元测试

**文件：** `src/__tests__/skill/registry.test.ts`
**依赖：** T3
**步骤：**
1. 测试用例：
   - activate 后 getActiveSkillBodies 包含正文
   - 参数替换：`{{arg1}}` 正确替换为传入值
   - 多 Skill 激活时 getActiveSkillBodies 返回所有正文
   - deactivate 后对应 Skill 不再出现
   - clear 后所有激活清空
   - allowedTools 取并集：Skill A 白名单 [Bash] + Skill B 白名单 [Read] = [Bash, Read]
   - 无限制 Skill 激活时 getEffectiveAllowedTools 返回全部
   - validateAllowedTools 检测不存在的工具名

**验证：** `pnpm test src/__tests__/skill/registry.test.ts` 全部通过

## T17: 编写 activator 单元测试

**文件：** `src/__tests__/skill/activator.test.ts`
**依赖：** T4
**步骤：**
1. 测试用例：
   - loadSkill 加载存在的 Skill 返回 SkillLoadResult
   - loadSkill 加载不存在的 Skill 返回 null
   - loadSkillByIntent 根据 task 文本匹配到对应 Skill
   - loadSkillByIntent 无匹配时返回 null
   - 参数传递到 loadSkill 后正文中占位符被替换

**验证：** `pnpm test src/__tests__/skill/activator.test.ts` 全部通过

## 执行顺序

```
T1 ──→ T2 ──→ T4 ──→ T5
  │      │             │
  │      └──→ T3 ──→ T4 ──→ T5
  │                    │
  │                    └──→ T9 ──→ T13 ──→ T14
  │                                    │
  ├── T10 ──→ T11 ──→ T13             │
  │                                    │
  ├── T12 ─────────────────────────────┘
  │
  └── T6、T7、T8（与 T2-T14 并行）
  
T2 ──→ T15（测试）
T3 ──→ T16（测试）
T4 ──→ T17（测试）
```
