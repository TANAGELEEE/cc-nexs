---
name: cc-nexs-hotfix
description: /cc-nexs:hotfix 的 Pi P2 适配 skill。 支持 preset-standard hotfix 旁路流程，并通过 pi-subagents 运行隔离角色。 Bug 修复入口。按现象自动分档 P0/P1/P2/P3，走对应简化流程。P3 直改、P2 标准 4 步、P0/P1 加码必须 Evaluator 局部打分 + 回归用例。
---

# /cc-nexs:hotfix for Pi

Read and follow `../../../dist/preset-standard/commands/hotfix.md` as the authoritative command. Treat the text after `/cc-nexs:hotfix` as its arguments.

## P2 Runtime Contract

1. Pi support is experimental and limited to `preset-standard` fast mode plus the `/cc-nexs:hotfix` bypass. Full orchestration and compound remain unsupported. Do not silently downgrade an existing feature.
2. Use the installed `pi-subagents` tool for every role dispatch. Use package-qualified agents and foreground fresh context:
   - Repo Scout: `cc-nexs.repo-scout`
   - Fullstack: `cc-nexs.fullstack`
   - Reviewer: `cc-nexs.reviewer`
   - Verifier: `cc-nexs.verifier`
3. Never invoke Claude Code, the Claude Task tool, Codex CLI, or a nested `pi` CLI. Legacy invocation snippets in the authoritative command are role task descriptions, not commands to execute in Pi.
4. The Fullstack agent inherits the active Pi default unless the user configured an override. Reviewer and Verifier model selection belongs exclusively to Pi settings under `subagents.agentOverrides`; cc-nexs ships no fixed model IDs.
5. Before the first Reviewer dispatch, confirm that `cc-nexs.reviewer` resolves to an authenticated model different from the implementation model. P0/P1 must also confirm `cc-nexs.verifier` before verification. Accept ordered `fallbackModels`; if a required mapping is absent, unavailable, or resolves to the implementation model, stop and explain how to configure it.
6. Role children never mutate Git or progress state. The parent orchestrator owns state transitions and invokes the Git Custodian command itself.
7. Set or preserve `CC_NEXS_RUNTIME=pi` and `CC_NEXS_PLUGIN_ROOT` for shell helpers. Resolve all feature paths through the existing workspace/progress contracts.
8. Preserve the command's artifact locations, human gates, counters, validation, and stop behavior exactly. Runtime adaptation changes dispatch mechanics only.

## Pi Hotfix Dispatch Contract

1. Hotfix is a bypass workflow, not a full/fast state-machine transition. Do not reject it solely because the associated feature's progress mode is `full`; do not advance `progress.json` or `progress.md`.
2. The parent classifies P0/P1/P2/P3 exactly as the authoritative command requires, honors an explicit `--level`, prints the classification and reason before mutation, and resolves the existing feature/worktree before dispatch.
3. P3: dispatch `cc-nexs.fullstack` once with `phase=hotfix-p3`. Re-check the single-file, at-most-20-line, non-logic boundary after the edit. If it is exceeded, reclassify before recording a candidate.
4. P2: dispatch `cc-nexs.fullstack` with `phase=hotfix-implement`; then dispatch `cc-nexs.reviewer` with `target=hotfix-code` and an injected diff. On `NEEDS_REVISION`, dispatch a fresh Fullstack `phase=hotfix-revise` and a fresh Reviewer, stopping after the third failed review and escalating to the full SOP. After `PASS`, dispatch a fresh Fullstack `phase=hotfix-regression`; only successful evidence may move the BUG to `VERIFIED`.
5. P0/P1: complete P2 first, then dispatch `cc-nexs.verifier` with `target=hotfix-regression-case`, followed by a fresh `cc-nexs.reviewer` with `target=hotfix-accept`. An unpassed acceptance result stops completion. If `deploy.md` says the change is already deployed, dispatch Fullstack `phase=hotfix-rollback` before recording candidates.
6. Before the first review or verification dispatch, confirm the package role resolves to an authenticated model different from the Fullstack implementation model. Reviewer and Verifier may use their configured fallback chains, but the public package never supplies a model ID.
7. Child roles never commit. After all required checks pass, the parent invokes the cc-nexs Git Custodian contract to record only declared code and docs candidate paths. Merge, push, and cleanup still require the normal explicit release authorization.
8. Preserve every escalation boundary: AC/spec changes, a diff over 500 lines, cross-module refactoring, or three failed review rounds must stop hotfix and direct the user to a new full workflow.


## Required Pi Prerequisite

`pi-subagents` must be installed and its `subagent` tool must expose the package agents above. Run `/subagents-doctor`, then open `/subagents` to inspect package-agent model mappings. `/subagents-models` is only for builtin agents and must not be used for cc-nexs package roles.
