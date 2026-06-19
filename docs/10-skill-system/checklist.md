# Skill 系统 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] `src/skill/types.ts` 已创建，所有类型可正常导出（验证：`npx tsc --noEmit` 无类型错误）
- [ ] `src/skill/loader.ts` 已实现，scanAll 和 loadOne 可正常导入（验证：编译通过）
- [ ] `src/skill/registry.ts` 已实现，SkillRegistry 类所有方法可用（验证：编译通过）
- [ ] `src/skill/activator.ts` 已实现，loadSkill 和 loadSkillByIntent 可用（验证：编译通过）
- [ ] `src/skill/builtin/commit.md` 已创建，frontmatter 格式正确（验证：YAML frontmatter 可解析）
- [ ] `src/skill/builtin/review.md` 已创建，frontmatter 格式正确（验证：YAML frontmatter 可解析）
- [ ] `src/skill/builtin/test.md` 已创建，frontmatter 格式正确（验证：YAML frontmatter 可解析）
- [ ] `src/tool/tools/load-skill.ts` 已创建，LoadSkill 工具可注册到 ToolRegistry（验证：编译通过）
- [ ] `src/bootstrap/types.ts` 已扩展 BootstrapContext（验证：`skillScanData` 字段存在）
- [ ] `src/skill/fork.ts` 已实现 Fork 模式执行（验证：编译通过）
- [ ] `src/agent/types.ts` 和 `src/agent/loop.ts` 已扩展 allowedTools 支持（验证：编译通过）

## 集成

- [ ] `src/chat/chat-service.ts` 创建唯一 SkillRegistry，在 system prompt 中注入 Skill 摘要和激活正文（验证：编译通过）
- [ ] `src/bootstrap/context-builder.ts` 在 buildNewSessionContext 中扫描 Skill 并将原始数据传入 BootstrapContext（验证：编译通过）
- [ ] `src/command/builtin/index.ts` 从 Skill 列表动态生成命令及别名（验证：编译通过，无硬编码 reviewCommand）
- [ ] `src/tool/registry.ts` 新增 getToolNames 和 getMetasWithFilter 方法（验证：编译通过）
- [ ] `src/tui/app.tsx` 清空对话时调用 skillRegistry.clear()（验证：编译通过）
- [ ] AgentLoop 在 full mode 时也应用 Skill 的 allowedTools 白名单（验证：编译通过）

## 编译与测试

- [ ] 项目编译无错误（验证：`npx tsc --noEmit`）
- [ ] loader 单元测试全部通过（验证：`pnpm test src/__tests__/skill/loader.test.ts`）
- [ ] registry 单元测试全部通过（验证：`pnpm test src/__tests__/skill/registry.test.ts`）
- [ ] activator 单元测试全部通过（验证：`pnpm test src/__tests__/skill/activator.test.ts`）
- [ ] 全部单元测试通过（验证：`pnpm test`）

## 端到端场景

- [ ] 场景 1：启动后自动显示可用 Skill — 启动 Codia，在对话中看到内置 commit、review、test 三个 Skill 的摘要（名字 + 说明）
- [ ] 场景 2：`/commit` 执行内联提交 — 修改一个文件但不 stage，输入 `/commit`，Agent 加载 commit Skill，分析变更，生成 commit message，逐文件 add 并 commit
- [ ] 场景 3：`/review` fork 审查 — 输入 `/review`，Agent 在独立上下文中审查变更，主对话仅收到摘要报告，不包含审查中间过程
- [ ] 场景 4：`/test` 智能分析 — 输入 `/test`，Agent 运行测试，报告结果。如果有失败，区分代码 bug vs 测试错误；全绿时报覆盖率
- [ ] 场景 5：用户自定义 Skill — 在 `<project>/.codia/skills/` 下创建一个自定义 Skill `.md` 文件，重启后 `/skill-name` 可被识别并执行
- [ ] 场景 6：优先级覆盖 — 同名 Skill 同时存在项目目录和用户目录，项目版本生效
- [ ] 场景 7：错误文件不阻断 — 在 Skill 目录下放一个 frontmatter 格式错误的 `.md` 文件，其他 Skill 正常工作
- [ ] 场景 8：清空对话清除 Skill — 激活一个 Skill 后 `/clear`，Skill 不再出现在上下文
- [ ] 场景 9：意图识别 — 用户说"帮我提交代码"，Agent 自动调用 LoadSkill 加载 commit Skill（注：依赖模型行为，非确定性，建议多次测试确认成功率 > 70%）
- [ ] 场景 10：多 Skill 同时激活 — 先激活 commit，再激活 test，两个 Skill 的正文均在上下文中
- [ ] 场景 11：别名命令 — `/cr` 触发 review Skill，行为与 `/review` 一致
- [ ] 场景 12：Fork 上下文隔离 — Fork 模式 review 执行完后，主对话中看不到 review 的逐轮交互过程，只看到摘要
- [ ] 场景 13：allowedTools 生效 — 激活 allowedTools=["Bash"] 的 Skill 后，Agent 无法调用 Read/Write 等不在白名单中的工具
