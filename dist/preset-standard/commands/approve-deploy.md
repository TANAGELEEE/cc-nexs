---
description: Approve deploy gate G2 in authoritative progress.json v2, mirror the human-readable view, then resume via /cc-nexs:run.
allowed-tools: Read, Write, Edit, Bash
argument-hint: [feature_id]
---

# /cc-nexs:approve-deploy

G2 人工门禁：确认代码已部署到测试环境，QA 可以开始执行测试。

## Steps

1. Resolve the installed plugin root containing this command. Run the deterministic control command; do not edit `progress.json` or `progress.md` directly:
   ```bash
   node "<plugin-root>/lib/cc-nexs-cli.mjs" approve-deploy <feature_id> [M<N>]
   ```
   Claude Code resolves `<plugin-root>` from `CLAUDE_PLUGIN_ROOT`. Codex resolves it relative to the active mirror skill. Pi's registered command calls the same core implementation directly.
2. The control command verifies the state, derives the full-mode sprint from `SPRINT_<N>_DEPLOY_GATE`, records the G2 approval event, and refreshes the Markdown mirror. Fast mode stores a single G2 approval. It never changes the deploy-gate state directly; the orchestrator owns the next transition.
3. Never execute `/cc-nexs:approve-deploy` as a shell path. It is a Claude Code/Pi command alias; Codex uses `$cc-nexs-approve-deploy`; a regular shell uses `cc-nexs approve-deploy`.
4. Print:
   ```
   ✅ Deploy gate approved (G2)
      Feature: <id> <slug>
      Sprint: M<N>               ← full 模式
      Approver: <name>
      Approved at: <ts>
      Next: QA testing begins
   ```
5. Continue the current runtime's `run` workflow so the state machine can enter QA. Do not launch the slash-style alias as a shell command.

## Per-sprint semantics (full mode)

Full mode 每个 Sprint 都有独立的 DEPLOY_GATE。M1 的 approve 不放行 M2。状态机读取 `workflow.g2_approved_sprints[N]` 判断当前 sprint 是否已批准。

`progress.json.gates.g2.sprints["1"]` records M1 approval; M2 remains absent and therefore unapproved.

## Why not manually transition state

The state machine (`nextStep`) already handles `DEPLOY_GATE` + per-sprint approval → next state. Manually overriding `current_state` here would bypass the orchestrator's conclusion parsing and README sync logic. Only the deterministic control command sets the flag; the `run` workflow drives the transition.
