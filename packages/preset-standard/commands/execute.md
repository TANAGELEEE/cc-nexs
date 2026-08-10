---
description: "Lean 实现入口。按 plan 任务和路径所有权并行实现，不负责 Git mutation。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep, Task"
argument-hint: "[需求编号] [--phase=implement|review-fix|test-fix|gateway-b-fix|base-sync]"
---

# /cc-nexs:execute

仅用于 `mode=lean` 且计划已批准。读取 plan task DAG，按波次派发独立 `lean-developer`：

- 只有允许修改路径不重叠的任务可并行；重叠任务串行。
- 每个 child 只收到自己的 AC、task、worktree、允许路径和验证命令。
- child 禁止 Git mutation，只返回精确修改路径和检查结果。
- Orchestrator 校验路径后调用 Git Custodian candidate；每仓 feature branch 固定为 `feature/<id>-<slug>`。
- 实现前/修复后先用 Custodian prepare 同步最新 base；base 变化必须重新本地验证、Review 闭环和 test 发布。
- `review-fix` 只处理集中 Review 的 P0/P1 编号；`test-fix` 只处理 test 环境失败；禁止顺手重构。
- `gateway-b-fix` 只处理 `plan.md` 当前 Gateway B implementation request 的 AC 和允许路径；发现需求/AC/批准方案变化必须停止并改走 scope request。

任何 requirements 或 `APPROVAL-SCOPE` 变化使 Plan Gate 失效并停止。
