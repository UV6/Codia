# Codia

我正在构建一个终端 AI 编程助手（类似 Codex），项目名叫 Codia，使用 TypeScript 实现。

## 语言
中文回答，中文注释。

## 测试

开发完功能后，分两层验证：

1. 单元/集成测试：用 vitest 写逻辑测试（非 UI），`pnpm test` 全部通过才算完成
2. 端到端测试：由我在本地终端手动测试，AI 不写 e2e 脚本，改为提供测试清单让我自己跑

每次开发完后，AI 应主动告诉我 checklist 中哪些场景需要在终端里测试。我去测试，把结果反馈给 AI。

## 提交规范

开发这个仓库时，遵循 Conventional Commits 规范：

1. 每次 commit 消息格式：`<type>: <描述>`
2. `type` 使用：`fix`、`feat`、`docs`、`test`、`refactor`、`chore`、`perf`、`ci`、`build`
3. 提交消息用中文描述
4. 小功能开发完就提交一次，不要积累大量改动后一次性提交
