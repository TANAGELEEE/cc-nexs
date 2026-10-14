---
name: "commit-discipline"
description: "cc-nexs candidate 提交约束。由 Git Custodian 提交指定路径，保留评审和验证绑定的提交历史。"
disable-model-invocation: true
---

# Candidate 提交

遵循 `rules/git-custodian-boundary.md`。角色返回精确修改路径和检查结果，由 Orchestrator 调用 Git Custodian；本 skill 不直接执行 Git mutation。

提交按有意义的实现边界组织，不设置 commit 数量上限，也不因 Sprint 结束自动 squash/rebase。已用于 Review、本地验证或 test attempt 的 candidate 保持不可变；代码变化产生新 candidate 并按当前模式重新验证，不能通过整理历史复用旧证据。

提交信息沿用目标项目格式；未规定时使用 `<type>: <简述>`，说明具体变化。Custodian 只 stage 已分配路径，提交前核对 diff、避免凭据，并保留 hooks。

Lean/Hotfix 的文档在所属 docs worktree 中维护，仅在代码 base release 已证明且状态为 COMPLETE 后生成最终 docs candidate。Fast/Full 的提交时机由当前 run rule 定义。发布、合并与清理由 release controls 和已有授权决定；本 skill 不增加审批或远端写权限。
