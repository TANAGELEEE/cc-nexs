---
name: cc-nexs-qa
description: /cc-nexs:qa 的 Codex 镜像 skill。 显式调用 $cc-nexs-qa 时使用。 QA 黑盒测试入口。Sprint 阶段写/评用例；完整需求发布到 test 后执行 final 或 final-regression。禁读 src/。
---

# /cc-nexs:qa for Codex

This explicit-only skill is a thin Codex runtime adapter for `/cc-nexs:qa`.

## Authoritative Command

Read and follow `../../commands/qa.md` as the single source of truth for this command. Treat the user's original message after `/cc-nexs:qa` as the command arguments.

## Codex Runtime Delta

- Dispatch every requested role as an independent native subagent using `../../agents/`; keep implementation, Review, and verification in fresh isolated sessions. For Fast/Full implementation fanout, spawn every same-wave worker with its progress-assigned worktree and frozen role runtime before awaiting any of them, then join the whole wave; never serialize spawn/await or create extra agent worktrees. Never invoke Claude Code, a Claude subagent tool, or a nested `codex` CLI process.
- Resolve automatic risk routing once from progress/config/approved-plan: Explicit Lean high/critical can upgrade the first Planner dispatch; discovered plan risk upgrades subsequent Reviewer dispatch without starting a second Planner; Hotfix P0/P1 upgrades Reviewer; an explicit feature role profile remains final. A Reviewer may use a different model or the same model with higher reasoning effort. Provider-specific IDs are allowed only in private project/feature config; public defaults remain portable.
- Translate `$CLAUDE_PLUGIN_ROOT` to this installed Codex plugin root and preserve the authoritative command's state transitions, gates, counters, validation, and stop behavior.
- Browser tooling, login/MFA state, and verification-page URL availability are checked only after the exact candidate reaches test and CI delivery completes. They never block delivery. If post-deployment verification cannot run, record `manual_required` / `deployed_needs_manual_verification` with evidence and leave it recoverable; never claim a pass.

## Document Write Map

Preserve exactly the paths declared by the authoritative command: ordinary features use `all-docs/doc/{id}.{slug}/` and `progress.md`; new Hotfix tasks use the BUG identified by `progress.hotfix_document` with machine state in workspace `.cc-nexs/hotfixes/<key>/`. A related BUG uses `doc/<id>.<slug>/bugs/BUG-<key>.md`; otherwise use docs `hotfix/<key>/BUG-001.md`. Keep legacy `hotfix.md`, command-declared `bugs/` / `qa-scripts/`, and `docs/solutions/` compatible. Hotfix does not reserve a feature number or publish placeholders. Pass `CC_NEXS_PROGRESS_FILE` and the resolved `BUG_FILE` to Hotfix children; never infer the BUG from a private-state directory. Do not invent Codex-specific alternatives.

## Full / Fast / Hotfix Mode Locks

The authoritative command alone defines `lean, full, fast, and hotfix` semantics. This adapter changes only Codex dispatch and runtime mechanics; it must not restate, reorder, or weaken a mode.

## Completion Rule

The command is complete only when the artifact, state, and summary expected by `../../commands/qa.md` are present in the original cc-nexs locations.
