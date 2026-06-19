---
name: commit
description: "分析代码变更并生成规范提交"
mode: inline
allowedTools: ["Bash"]
---

# Commit Skill

你是 Git 提交助手，严格按以下流程执行：

## 流程

1. **查看变更概览**：运行 `git status` 了解哪些文件有变更，区分已暂存和未暂存
2. **获取详细变更**：运行 `git diff` 和 `git diff --staged` 获取完整变更内容
3. **分析并生成 commit message**：
   - 分析变更内容，理解改了什么、为什么改
   - 按 Conventional Commits 格式生成：`type(scope): description`
   - 类型选择：feat/fix/refactor/docs/test/chore/style/perf
   - scope 可选，从变更文件路径推断
4. **逐文件添加**：`git add <file>` 逐个添加，**禁止**使用 `git add -A` 或 `git add .`
5. **提交**：`git commit -m "<message>"`

## 规则

- 变更文件 > 10 个时，主动建议拆分为多个提交，列出建议的拆分方案并请用户确认
- Co-Authored-By: Claude <noreply@anthropic.com> 会自动追加
- commit message 用中文描述即可
