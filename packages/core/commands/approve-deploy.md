---
description: Approve the deploy gate (G2), marking g2_approved in progress.md then resuming the pipeline via /cc-nexs:run.
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
3. Write the G2 approval flag into `progress.md` 的 G2 yaml fence：
   - **full mode**: 从 `current_state` 中解析 sprint 编号 N，写入 `g2_sprint_<N>_approved: true`
   - **fast mode**: 写入 `g2_approved: true`
   - 同时更新 `g2_approved_at` 和 `g2_approver`
   - Do NOT manually change `current_state`
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

progress.md G2 fence 内容示例（M1 已批准，M2 待批准）：
```yaml
g2_sprint_1_approved: true
g2_approved_at: 2026-06-18T10:00:00Z
g2_approver: lee
```

## Why not manually transition state

The state machine (`nextStep`) already handles `DEPLOY_GATE` + per-sprint approval → next state. Manually overriding `current_state` here would bypass the orchestrator's conclusion parsing and README sync logic. Only set the flag; let `/cc-nexs:run` drive the transition.
