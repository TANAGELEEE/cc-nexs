---
description: "Approve deploy gate G2 in authoritative progress.json v2, mirror the human-readable view, then resume via /cc-nexs:run."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash"
argument-hint: "[feature_id]"
---

# /cc-nexs:approve-deploy

G2 人工 fallback：确认完整 candidate 已合入 test、发布并完成必要环境检查，QA 可以继续。仅显式退出自动 test 发布、前置能力不足或 legacy per_sprint 时使用。

## Steps

1. Resolve the installed plugin root containing this command. Run the deterministic control command; do not edit `progress.json` or `progress.md` directly:
   ```bash
   node "<plugin-root>/lib/cc-nexs-cli.mjs" approve-deploy <feature_id> [M<N>]
   ```
   Claude Code resolves `<plugin-root>` from `CLAUDE_PLUGIN_ROOT`. Codex resolves it relative to the active mirror skill. Pi's registered command calls the same core implementation directly.
2. The control command verifies `TEST_RELEASE`, legacy `DEPLOY_GATE`, or legacy `SPRINT_<N>_DEPLOY_GATE`, records the G2 approval event, and refreshes the Markdown mirror. Final-only/full and fast store a single approval; legacy per-sprint derives M<N>. It never changes state directly.
3. Never execute `/cc-nexs:approve-deploy` as a shell path. It is a Claude Code/Pi command alias; Codex uses `$cc-nexs-approve-deploy`; a regular shell uses `cc-nexs approve-deploy`.
4. Print:
   ```
   ✅ Deploy gate approved (G2)
      Feature: <id> <slug>
      Sprint: <final|M<N>>       ← M<N> 仅 legacy per_sprint
      Approver: <name>
      Approved at: <ts>
      Next: QA testing begins
   ```
5. Continue the current runtime's `run` workflow so the state machine can enter QA. Do not launch the slash-style alias as a shell command.

## Delivery semantics

New final-only full mode and fast mode use one requirement-level G2 at `TEST_RELEASE`. Approval attests test integration, deployment, and required environment checks; it never attests production release.

Legacy full mode keeps an independent DEPLOY_GATE per Sprint. M1 approval does not release M2.

`progress.json.gates.g2.sprints["1"]` records M1 approval; M2 remains absent and therefore unapproved.

## Why not manually transition state

The state machine (`nextStep`) already handles `DEPLOY_GATE` + per-sprint approval → next state. Manually overriding `current_state` here would bypass the orchestrator's conclusion parsing and README sync logic. Only the deterministic control command sets the flag; the `run` workflow drives the transition.
