---
description: Approve deploy gate G2 in authoritative progress.json v2, mirror the human-readable view, then resume via /cc-nexs:run.
allowed-tools: Read, Write, Edit, Bash
argument-hint: [feature_id]
---

# /cc-nexs:approve-deploy

G2 人工门禁：确认代码已部署到测试环境，QA 可以开始执行测试。

## Steps

1. Locate `progress.md` (same logic as `/cc-nexs:run`)
2. Verify current state matches deploy gate:
   - full mode: `current_state` matches `SPRINT_<N>_DEPLOY_GATE`
   - fast mode: `current_state == DEPLOY_GATE`
   - If neither, print current state and return.
3. Call `approveProgressGate(progress.json, { gate: 'g2', approver, sprint })`:
   - **full mode**: parse N from `current_state` and pass `sprint: N`
   - **fast mode**: pass `sprint: null`
   - The function atomically records approver, timestamp, and an immutable event
   - Do NOT manually change `current_state` or edit progress.json
   - progress.md may be refreshed as a human-readable mirror only
4. Print:
   ```
   ✅ Deploy gate approved (G2)
      Feature: <id> <slug>
      Sprint: M<N>               ← full 模式
      Approver: <name>
      Approved at: <ts>
      Next: QA testing begins
   ```
5. Auto-continue: immediately invoke `/cc-nexs:run <id>` to resume the pipeline.

## Per-sprint semantics (full mode)

Full mode 每个 Sprint 都有独立的 DEPLOY_GATE。M1 的 approve 不放行 M2。状态机读取 `workflow.g2_approved_sprints[N]` 判断当前 sprint 是否已批准。

`progress.json.gates.g2.sprints["1"]` records M1 approval; M2 remains absent and therefore unapproved.

## Why not manually transition state

The state machine (`nextStep`) already handles `DEPLOY_GATE` + per-sprint approval → next state. Manually overriding `current_state` here would bypass the orchestrator's conclusion parsing and README sync logic. Only set the flag; let `/cc-nexs:run` drive the transition.
