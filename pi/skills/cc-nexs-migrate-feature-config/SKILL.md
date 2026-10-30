---
name: cc-nexs-migrate-feature-config
description: "/cc-nexs:migrate-feature-config Pi P2 adapter skill. Invoke only through /cc-nexs:migrate-feature-config or /skill:cc-nexs-migrate-feature-config; never auto-trigger from ordinary natural-language requests. Supports preset-standard lean (default) and standalone hotfix modes with each role in an isolated Pi process. Safely migrate an existing Lean/Hotfix config.json to automatic risk-based model routing without removing explicit overrides."
disable-model-invocation: true
---

# /cc-nexs:migrate-feature-config for Pi

Read and follow `../../../dist/preset-standard/commands/migrate-feature-config.md` as the authoritative command. Treat the text after `/cc-nexs:migrate-feature-config` as its arguments.

## Deterministic Lean Control

Resolve `../../../packages/core/lib/cc-nexs-cli.mjs` relative to this SKILL.md and execute:

```text
node <resolved-cli-path> migrate-feature-config <feature-id> [--dry-run] [--bind-plan-risk] [--progress <path>]
```

Never replace this control with model-generated progress edits or ad hoc Git commands.

## P2 Runtime Contract

Before role dispatch, read `../../../dist/preset-standard/rules/model-discovery.md` and use `cc_nexs_model_gateway` inspect/prepare/start/result. Call `cc_nexs_models` only for missing or invalidated catalogs. Show the non-blocking preview on first use or changes; never wait for a reply. Retain explicit overrides.

1. Pi supports `preset-standard` lean (default) and standalone hotfix; unsupported compound flows fail closed rather than downgrade.
2. Dispatch a bounded wave using `cc_nexs_dispatch({ tasks: [{ agent: "cc-nexs.lean-developer", task: "<assignment>", cwd: "<assigned absolute worktree>", model: "<frozen provider/model>", effort: "<frozen thinking>" }], concurrency: 1 })`. Hotfix children also receive `env: { CC_NEXS_PROGRESS_FILE, BUG_FILE }`. Put every sibling of the wave in one call; never create child worktrees or nested children.

Pi core has no subagent tool, so `cc_nexs_dispatch` runs each child as its own headless `pi --mode json -p --no-session` process in the assigned cwd, with the role's tools and system prompt from the package `pi/agents/`, fresh context, and the frozen model/thinking. The call returns only after every child exits, with per-child `ok`, `output` and `error`; no waiting tool, polling or sleeping is needed. No third-party subagent package is required.

3. Test merge/CI delivery runs before browser capability selection. Only after deployment, prefer ego lite; otherwise use `@injaneity/pi-computer-use@0.4.3` when effective config has `browser_use: true` and `headless: true`. Missing browser/login/MFA/verification URL capability records recoverable `manual_required` evidence and never blocks or rolls back delivery.
4. Never invoke Claude Code, the Claude Task tool, Codex CLI, or a `pi` CLI yourself; only `cc_nexs_dispatch` starts role processes. Runtime adaptation changes dispatch only; preserve the authoritative command's paths, state transitions, gates, counters, validation, and stop behavior.
5. Resolve automatic risk routing once: Explicit Lean high/critical can upgrade the first Planner dispatch; discovered plan risk upgrades subsequent Reviewer dispatch without starting a second Planner; Hotfix P0/P1 upgrades Reviewer; an explicit feature role profile remains final. Reviewer may use another model or the same model with higher thinking. `cc_nexs_dispatch` passes thinking to each child; public files ship no provider-specific model IDs.
6. `inherit` uses the parent's current model and thinking. After the wave returns, retry ordered `fallback_models` only for failed/unavailable tasks; never rerun successful siblings. Record gateway success only after real successful completion, never after spawn acceptance.
7. Role children never mutate Git or `progress.md` / `progress.json`. The parent owns state transitions and Git Custodian operations, and preserves `CC_NEXS_RUNTIME=pi` plus `CC_NEXS_PLUGIN_ROOT`. For Hotfix children, also pass `CC_NEXS_PROGRESS_FILE` and the resolved `BUG_FILE`; machine-state directories do not determine document paths.



## Required Pi Prerequisites

Install the cc-nexs package with the local installer and reload Pi. Role children load the same configured Pi packages, providers and credentials as the parent, and the cc-nexs extension enforces the role boundary inside each child.

After test delivery, automatic verification prefers an onboarded ego lite app plus the `ego-browser` skill and a minimal `ego-browser nodejs` probe. Otherwise it may use `@injaneity/pi-computer-use@0.4.3` with effective `browser_use: true` and `headless: true`. If neither provider or signed-in session is ready, preserve the deployment, record `manual_required`, and resume manual verification later; do not silently claim a pass.
