---
name: cc-nexs-request-release-changes
description: "/cc-nexs:request-release-changes Codex mirror skill. Use when $cc-nexs-request-release-changes is explicitly invoked. Record Gateway B feedback and route evidence-only, implementation, or scope changes safely."
---

# /cc-nexs:request-release-changes for Codex

This explicit-only skill is a thin Codex runtime adapter for `/cc-nexs:request-release-changes`.

## Authoritative Command

Read and follow `../../command-docs/request-release-changes.md` as the single source of truth for this command. Treat the user's original message after `/cc-nexs:request-release-changes` as the command arguments.

## Deterministic Gateway B Change Control

Resolve `../../lib/cc-nexs-cli.mjs` relative to this SKILL.md and execute:

```text
node <resolved-cli-path> request-release-changes <feature-id> --type <evidence|implementation|scope> --feedback <text> [--ac <id>] [--path <path>]
```

Never edit progress state directly or combine this request with release approval.

## Codex Runtime Delta

Before role dispatch, read `../../rules/model-discovery.md` and use `modelGateway` inspect/prepare/start/result. Reuse the current host's cached choices before discovery. Show the non-blocking preview on first use or changes; never wait for a reply. Use the current native spawn tool catalog when discovery is needed; retain explicit overrides.

- Dispatch every requested role as an independent native subagent using `../../agents/`; keep implementation, Review, and verification in fresh isolated sessions. Never invoke Claude Code, a Claude subagent tool, or a nested `codex` CLI process.
- Resolve automatic risk routing once from progress/config/approved-plan: Explicit Lean high/critical can upgrade the first Planner dispatch; discovered plan risk upgrades subsequent Reviewer dispatch without starting a second Planner; Hotfix P0/P1 upgrades Reviewer; an explicit feature role profile remains final. A Reviewer may use a different model or the same model with higher reasoning effort. Provider-specific IDs are allowed only in private project/feature config; public defaults remain portable.
- Translate `$CLAUDE_PLUGIN_ROOT` to this installed Codex plugin root and preserve the authoritative command's state transitions, gates, counters, validation, and stop behavior.
- Browser tooling, login/MFA state, and verification-page URL availability are checked only after the exact candidate reaches test and CI delivery completes. They never block delivery. If post-deployment verification cannot run, record `manual_required` / `deployed_needs_manual_verification` with evidence and leave it recoverable; never claim a pass.

## Document Write Map

Preserve exactly the paths declared by the authoritative command: ordinary features use `all-docs/doc/{id}.{slug}/` and `progress.md`; new Hotfix tasks use the BUG identified by `progress.hotfix_document` with machine state in workspace `.cc-nexs/hotfixes/<key>/`. A related BUG uses `doc/<id>.<slug>/bugs/BUG-<key>.md`; otherwise use docs `hotfix/<key>/BUG-001.md`. Keep legacy `hotfix.md`, command-declared `bugs/`, and `docs/solutions/` compatible. Hotfix does not reserve a feature number or publish placeholders. Pass `CC_NEXS_PROGRESS_FILE` and the resolved `BUG_FILE` to Hotfix children; never infer the BUG from a private-state directory. Do not invent Codex-specific alternatives.

## Lean / Hotfix Mode Locks

The authoritative command alone defines `lean and hotfix` semantics. This adapter changes only Codex dispatch and runtime mechanics; it must not restate, reorder, or weaken a mode.

## Completion Rule

The command is complete only when the artifact, state, and summary expected by `../../command-docs/request-release-changes.md` are present in the original cc-nexs locations.
