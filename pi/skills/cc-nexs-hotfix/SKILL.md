---
name: cc-nexs-hotfix
description: /cc-nexs:hotfix 的 Pi P2 适配 skill。 仅允许通过 /cc-nexs:hotfix 或 /skill:cc-nexs-hotfix 显式调用；不得因普通自然语言请求自动触发。 支持 preset-standard 独立 hotfix mini-Lean，并通过 pi-subagents 运行隔离角色。 独立 Hotfix mini-Lean：latest-base worktree、本地验证、一次集中 Review、test 黑盒验收、人工 base 门禁。
disable-model-invocation: true
---

# /cc-nexs:hotfix for Pi

Read and follow `../../../dist/preset-standard/commands/hotfix.md` as the authoritative command. Treat the text after `/cc-nexs:hotfix` as its arguments.

## Deterministic Hotfix Controls

Resolve `../../../packages/core/lib/cc-nexs-cli.mjs` relative to this SKILL.md. Bind the completed hotfix scope with:

```text
node <resolved-cli-path> start-hotfix <feature-id> [--level P0|P1|P2|P3] [--related <feature-id>]
```

Subsequent local verification, Review recording, test release/verification, release approval, and base integration must use the packaged controls named by the authoritative command. Never edit progress state or perform ad hoc merge/push operations.

## P2 Runtime Contract

1. Pi support covers `preset-standard` lean (default), standalone hotfix, and legacy fast. Full orchestration and compound remain unsupported. Do not silently downgrade an existing feature.
2. Use the installed `pi-subagents` tool for every role dispatch. Use package-qualified agents and foreground fresh context:
   - Repo Scout: `cc-nexs.repo-scout`
   - Fullstack: `cc-nexs.fullstack`
   - Reviewer: `cc-nexs.reviewer`
   - Verifier: `cc-nexs.verifier`
   - Lean Planner: `cc-nexs.lean-planner`
   - Lean Developer: `cc-nexs.lean-developer`
   - Lean Reviewer: `cc-nexs.lean-reviewer`
   - Lean Verifier: `cc-nexs.lean-verifier`
   - Hotfix Developer: `cc-nexs.hotfix-developer`
   - Hotfix Reviewer: `cc-nexs.hotfix-reviewer`
   - Hotfix Verifier: `cc-nexs.hotfix-verifier`
3. Never invoke Claude Code, the Claude Task tool, Codex CLI, or a nested `pi` CLI. Legacy invocation snippets in the authoritative command are role task descriptions, not commands to execute in Pi.
4. Resolve automatic risk routing from one cc-nexs progress/config/approved-plan snapshot, then pass the selected `model` and `thinking` directly to the pi-subagents `Agent` call. Lean high/critical upgrades Planner and Reviewer; Hotfix P0/P1 upgrades Reviewer; an explicit feature role profile remains final. Omit `model` when it is `inherit`. If the primary model is unavailable, retry the ordered cc-nexs `fallback_models` list. Project `.pi/settings.json` remains only the Pi authentication/`enabledModels` authority; do not duplicate role mappings there. Public cc-nexs files ship no provider-specific model IDs.
5. Resolve Hotfix role profiles from one progress/config snapshot. P0/P1 automatically routes Reviewer to escalated; an explicit feature role profile remains final. Reviewer may use a different authenticated model or the same model with higher thinking, but always uses a fresh child context. P0/P1 heterogeneity is an optional private policy, not a public preset requirement. Accept ordered fallbackModels.
6. Role children never mutate Git or progress state. The parent orchestrator owns state transitions and invokes the Git Custodian command itself.
7. Set or preserve `CC_NEXS_RUNTIME=pi` and `CC_NEXS_PLUGIN_ROOT` for shell helpers. Resolve all feature paths through the existing workspace/progress contracts.
8. Preserve the command's artifact locations, human gates, counters, validation, and stop behavior exactly. Runtime adaptation changes dispatch mechanics only.

## Pi Hotfix Dispatch Contract

1. Hotfix must be initialized as `mode=hotfix` with its own id, `feature/<id>-<slug>`, and worktrees from the latest configured remote bases. A related feature is metadata only.
2. Fill and bind the sole authored `hotfix.md` scope with `start-hotfix` before dispatch. AC/API/database/permission contract changes or broad refactoring stop and become a new Lean/Full change.
3. Dispatch `cc-nexs.hotfix-developer` for implementation/fix. Candidate Git mutations remain parent Git Custodian work.
4. P0/P1/P2 dispatch `cc-nexs.hotfix-reviewer` exactly once; a blocked result permits one fresh delta Review only. P3 skips the model Review only after deterministic one-file, at-most-20-line, non-behavioral proof.
5. Run the configured local verification driver, then release the exact candidate with `release-test --hotfix`. Dispatch a fresh `cc-nexs.hotfix-verifier` on the deployed environment revision, including P3 smoke and P0/P1 rollback/AC evidence.
6. Reviewer may use a different model or the same model with higher thinking. Session isolation is mandatory; heterogeneity is optional project policy. Public files never pin a model ID.
7. Test failure or Gateway B implementation feedback consumes the same single lifetime delta Review, then requires a new candidate/test attempt. Delta blocking stops for human intervention.
8. Only `approve-release` authorizes the verified feature candidate to merge into configured base branches. Never merge test into base and never force push.


## Required Pi Prerequisites

`pi-subagents` must be installed and its `subagent` tool must expose the package agents above. Run `/subagents-doctor`, then open `/subagents` to inspect package-agent model mappings. `/subagents-models` is only for builtin agents and must not be used for cc-nexs package roles.

Automatic browser verification additionally requires an installed and onboarded ego lite app, the selected `ego-browser` skill, and a successful minimal `ego-browser nodejs` runtime probe. Verifier agents invoke `ego-browser` through Bash in isolated task Spaces. If a prerequisite is absent, keep cc-nexs available and use the manual test-release fallback; do not silently claim browser verification.
