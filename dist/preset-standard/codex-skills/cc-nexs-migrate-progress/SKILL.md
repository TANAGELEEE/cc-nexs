---
name: cc-nexs-migrate-progress
description: /cc-nexs:migrate-progress 的 Codex 镜像 skill。 仅当用户显式输入 "$cc-nexs-migrate-progress" 或在界面中选择该 skill 时使用；不得因普通自然语言请求自动触发。 Migrate a legacy human-readable progress.md into authoritative progress.json v2 while preserving progress.md as a rendered view.
---

# /cc-nexs:migrate-progress for Codex

This explicit-only skill is a thin Codex runtime adapter for `/cc-nexs:migrate-progress`.

## Authoritative Command

Read and follow `../../commands/migrate-progress.md` as the single source of truth for this command. Treat the user's original message after `/cc-nexs:migrate-progress` as the command arguments.

## Codex Runtime Delta

- Dispatch every requested role as an independent native subagent using `../../agents/`; keep implementation, Review, and verification in fresh isolated sessions. For Fast/Full implementation fanout, spawn every same-wave worker with its progress-assigned worktree and frozen role runtime before awaiting any of them, then join the whole wave; never serialize spawn/await or create extra agent worktrees. Never invoke Claude Code, a Claude subagent tool, or a nested `codex` CLI process.
- Resolve automatic risk routing once from progress/config/approved-plan: Lean high/critical upgrades Planner and Reviewer; Hotfix P0/P1 upgrades Reviewer; an explicit feature role profile remains final. A Reviewer may use a different model or the same model with higher reasoning effort. Provider-specific IDs are allowed only in private project/feature config; public defaults remain portable.
- Translate `$CLAUDE_PLUGIN_ROOT` to this installed Codex plugin root and preserve the authoritative command's state transitions, gates, counters, validation, and stop behavior.
- Browser tooling, login/MFA state, and verification-page URL availability are checked only after the exact candidate reaches test and CI delivery completes. They never block delivery. If post-deployment verification cannot run, record `manual_required` / `deployed_needs_manual_verification` with evidence and leave it recoverable; never claim a pass.

## Document Write Map

Preserve exactly the paths declared by the authoritative command, including `all-docs/doc/{id}.{slug}/`, its `progress.md` and `hotfix.md` records, command-declared `bugs/` or `qa-scripts/`, and `docs/solutions/`. Do not invent Codex-specific alternatives.

## Full / Fast / Hotfix Mode Locks

The authoritative command alone defines `lean, full, fast, and hotfix` semantics. This adapter changes only Codex dispatch and runtime mechanics; it must not restate, reorder, or weaken a mode.

## Completion Rule

The command is complete only when the artifact, state, and summary expected by `../../commands/migrate-progress.md` are present in the original cc-nexs locations.
