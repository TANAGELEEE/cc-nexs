---
description: Lean 默认模式计划入口。并行只读调研，生成唯一 requirements.md 与 plan.md，并停在 Gateway A。
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task
argument-hint: [需求编号]
---

# /cc-nexs:plan

仅用于 `mode=lean`。解析需求目录和 workspace，要求 `requirements.md` 非空且状态为 `INIT` 或 `PLANNING`。

1. 加载 preset/project/feature 的模型配置，按 `preset defaults < project models < feature config.json.models` 合并。
2. 用 `resolveRoleRuntime(..., 'lean-planner', runtime, {models})` 解析 model profile。Claude Task、Codex native agent、Pi package agent均使用解析后的 model/effort；`inherit` 表示沿用当前会话。
3. 派发一个独立 Lean Planner。它可以再并行派只读调研，但只回收事实摘要；不得保存子代理对话。
4. Planner 只维护 `requirements.md` 和 `plan.md`。`plan.md` 必须保留 `APPROVAL-SCOPE` markers；每个 AC 必须覆盖任务、本地检查和 test 检查，任务修改路径不得重叠。
5. Orchestrator 校验两份文档后，用确定性 `transitionState` 记录 `INIT → PLANNING → PLAN_PENDING_HUMAN`。角色不得直接改 progress。
6. 输出计划文件和 HTML 渲染入口，停止等待 `/cc-nexs:approve-plan <id>`。

高风险权限/支付/破坏性迁移/公开 API 破坏且无法用一次集中 Review 控制时，Planner 必须建议显式改走 full，不得暗中增加 Review 轮次。
