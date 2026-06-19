# Codia Spec 四文档 Review 规则

当 `/codia-spec` 流程中四份文档（spec.md、plan.md、task.md、checklist.md）全部生成完毕后，必须用 superpowers:requesting-code-review 对四份文档做独立审查，审查完收到反馈并修复后再让用户审批，不能让用户审批未经 review 的文档。

## 文档落盘位置

1. 从 `spec.md` 开始，四份文档就必须直接写入 `docs/` 下的新子目录，不要先写仓库根目录再迁移
2. 子目录命名格式为 `序号-名称`，序号取当前 `docs/` 目录下已有最大编号加一
3. 四份文档都放在同一个子目录下，并保持与现有 `docs/` 目录结构一致

## 流程

1. 先检查 `docs/` 下已有子目录，确定当前最大序号并创建新的 `序号-名称` 目录
2. 在该目录下依次维护 `spec.md`、`plan.md`、`task.md`、`checklist.md`
3. 四份文档全部写完后，调用 `Skill: superpowers:requesting-code-review`，把四份文档作为审查对象
4. 根据 review 结果修复
5. 修复后才向用户提审批
