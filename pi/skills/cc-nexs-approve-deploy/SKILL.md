---
name: cc-nexs-approve-deploy
description: /cc-nexs:approve-deploy 的 Pi P2 适配 skill。 仅允许通过 /cc-nexs:approve-deploy 或 /skill:cc-nexs-approve-deploy 显式调用；不得因普通自然语言请求自动触发。 支持 preset-standard lean（默认）与 fast 模式，并通过 pi-subagents 运行隔离角色。 Approve deploy gate G2 in authoritative progress.json v2, mirror the human-readable view, then resume via /cc-nexs:run.
disable-model-invocation: true
---

# /cc-nexs:approve-deploy for Pi

Read and follow `../../../dist/preset-standard/commands/approve-deploy.md` as the authoritative command. Treat the text after `/cc-nexs:approve-deploy` as its arguments.

## Deterministic Approval Control

Resolve `../../../packages/core/lib/cc-nexs-cli.mjs` relative to this SKILL.md and execute the packaged control program:

```text
node <resolved-cli-path> approve-deploy <feature-id> [M<N>]
```

Never execute `/cc-nexs:approve-deploy` as a shell path and never edit `progress.json` or `progress.md` directly. After the control program succeeds, continue the current runtime's run workflow.

## P2 Runtime Contract

1. Pi support covers `preset-standard` lean (default), standalone hotfix, and legacy fast. Full orchestration and compound remain unsupported. Do not silently downgrade an existing feature.
2. Use the installed `pi-subagents` tool for every role dispatch. Use package-qualified agents and foreground fresh context:
   - Repo Scout: `cc-nexs.repo-scout`
   - Fullstack: `cc-nexs.fullstack`
   - Reviewer: `cc-nexs.reviewer`
   - Verifier: ego lite `cc-nexs.verifier`; headless fallback `cc-nexs.verifier-computer-use`
   - Lean Planner: `cc-nexs.lean-planner`
   - Lean Developer: `cc-nexs.lean-developer`
   - Lean Reviewer: `cc-nexs.lean-reviewer`
   - Lean Verifier: ego lite `cc-nexs.lean-verifier`; headless fallback `cc-nexs.lean-verifier-computer-use`
   - Hotfix Developer: `cc-nexs.hotfix-developer`
   - Hotfix Reviewer: `cc-nexs.hotfix-reviewer`
   - Hotfix Verifier: ego lite `cc-nexs.hotfix-verifier`; headless fallback `cc-nexs.hotfix-verifier-computer-use`
3. Before any browser verifier dispatch, run the deterministic Pi browser capability preflight and freeze one provider for the release attempt. Prefer ego lite. If it is unavailable, select the matching `*-computer-use` agent only when `@injaneity/pi-computer-use@0.4.3` is installed and its effective config has `browser_use: true` plus `headless: true`. Otherwise route to manual G2. Never give one child both provider surfaces.
4. Never invoke Claude Code, the Claude Task tool, Codex CLI, or a nested `pi` CLI. Legacy invocation snippets in the authoritative command are role task descriptions, not commands to execute in Pi.
5. Resolve automatic risk routing from one cc-nexs progress/config/approved-plan snapshot, then pass the selected `model` and `thinking` directly to the pi-subagents `Agent` call. Lean high/critical upgrades Planner and Reviewer; Hotfix P0/P1 upgrades Reviewer; an explicit feature role profile remains final. Omit `model` when it is `inherit`. If the primary model is unavailable, retry the ordered cc-nexs `fallback_models` list. Project `.pi/settings.json` remains only the Pi authentication/`enabledModels` authority; do not duplicate role mappings there. Public cc-nexs files ship no provider-specific model IDs.
6. Resolve automatic risk routing from one progress/config/approved-plan snapshot: Lean high/critical routes Planner and Reviewer to escalated, Hotfix P0/P1 routes Reviewer to escalated, and an explicit feature role profile remains final. The Reviewer may use a different authenticated model or the same model with higher thinking, but must use a fresh child context. For legacy fast, preserve its configured heterogeneous-review guard. Accept ordered fallbackModels.
7. Role children never mutate Git or progress state. The parent orchestrator owns state transitions and invokes the Git Custodian command itself.
8. Set or preserve `CC_NEXS_RUNTIME=pi` and `CC_NEXS_PLUGIN_ROOT` for shell helpers. Resolve all feature paths through the existing workspace/progress contracts.
9. Preserve the command's artifact locations, human gates, counters, validation, and stop behavior exactly. Runtime adaptation changes dispatch mechanics only.



## Required Pi Prerequisites

`pi-subagents` must be installed and its `subagent` tool must expose the package agents above. Run `/subagents-doctor`, then open `/subagents` to inspect package-agent model mappings. `/subagents-models` is only for builtin agents and must not be used for cc-nexs package roles.

Automatic browser verification prefers an installed and onboarded ego lite app plus the selected `ego-browser` skill and a successful minimal `ego-browser nodejs` runtime probe. When ego lite is unavailable, it falls back to `@injaneity/pi-computer-use@0.4.3` only with effective `browser_use: true` and `headless: true`. If neither provider is ready, keep cc-nexs available and use the manual test-release fallback; do not silently claim browser verification.
