---
description: "Lean 默认模式计划入口。并行只读调研，生成唯一 requirements.md 与 plan.md，并停在 Gateway A。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep, Task"
argument-hint: "[需求编号]"
---

# /cc-nexs:plan

仅用于 `mode=lean`。解析需求目录和 workspace，要求 `requirements.md` 非空且状态为 `INIT` 或 `PLANNING`。

1. 要求 `config.json.config_version=2`；否则停止并提示 `/cc-nexs:migrate-feature-config <id>`。加载 `mergedModels`（public/overlay/project）和独立的 `featureConfig`，不得提前把 feature roles 合进 project models。
2. 用 `resolveRoleRuntime(preset, 'lean-planner', runtime, {models: mergedModels, featureConfig, progress: progressV2, planText})` 解析 profile。首次 `risk_tier:auto` 且尚无计划时使用 routing 默认风险；显式 feature `high|critical` 可在首次派发前升级。
3. 派发一个独立 Lean Planner。它可以再并行派只读调研，但只回收事实摘要；不得保存子代理对话。
4. Planner 只维护 `requirements.md` 和 `plan.md`。`plan.md` 必须保留 `APPROVAL-SCOPE` markers，并在标记内写且只写一个 `- risk_tier: low|medium|high|critical`；每个 AC 必须覆盖任务、本地检查和 test 检查，任务修改路径不得重叠。
5. 首稿完成后重新解析 Planner runtime。若首稿风险使 Planner 从日常 profile 自动路由到 `escalated`，且 feature 没有显式 profile override，则只追加一次全新 escalated Planner hardening：仅加固高风险边界、契约、回滚与验证矩阵，不创建新的 Review 循环。之后重新读取最终文档；无论风险是否变化都不得再派第三次 Planner。
6. Orchestrator 校验两份文档、唯一 concrete risk 和最终 route summary 后，用确定性 `transitionState` 记录 `INIT → PLANNING → PLAN_PENDING_HUMAN`。角色不得直接改 progress。
7. 输出风险来源、命中规则、最终 profile/model/effort、计划文件和 HTML 渲染入口，停止等待 `/cc-nexs:approve-plan <id>`。Gateway A 将 concrete risk 与 requirements/plan scope hash 一起绑定。

高风险权限/支付/破坏性迁移/公开 API 破坏且无法用一次集中 Review 控制时，Planner 必须建议显式改走 full，不得暗中增加 Review 轮次。
