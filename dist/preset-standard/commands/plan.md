---
description: "Lean default-mode planning entry point. Parallel read-only research, producing a single requirements.md and plan.md, one independent plan review, and stopping at Gateway A."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep, Task"
argument-hint: "[requirement-id]"
---

# /cc-nexs:plan

For `mode=lean` only. Resolve the requirement directory and workspace; require `requirements.md` to be non-empty and in `INIT` or `PLANNING` status.

1. Require `config.json.config_version=2`; otherwise stop and prompt `/cc-nexs:migrate-feature-config <id>`. Load `mergedModels` (public/overlay/project) and the separate `featureConfig`; do not merge feature roles into project models ahead of time.
2. Resolve the profile with `resolveRoleRuntime(preset, 'lean-planner', runtime, {models: mergedModels, featureConfig, progress: progressV2, planText})`. On the first `risk_tier:auto` with no plan yet, use the routing default risk; an explicit feature `high|critical` may be escalated before the first dispatch.
3. Dispatch one and only one independent Lean Planner. By default, search existing implementations directly; dispatch parallel read-only research only when there are two or more mutually independent factual questions that would clearly shorten the research. Do not add a second hardening Planner for the sake of "more comprehensiveness," and do not save subagent conversations.
4. The Planner maintains only `requirements.md` and `plan.md`. Prioritize reusing comparable capabilities already live in the project; do not arbitrarily expand optional hardening, generalized refactoring, or future risks into the current blocking scope; they may only be listed as non-blocking follow-ups.
5. `plan.md` must retain the `APPROVAL-SCOPE` markers, and within the markers write exactly one of each:
   - `- risk_tier: low|medium|high|critical`
   - `- delivery_lane: fast-track|standard`
   It must also write one machine-parsable `- test_delivery.<repo-id>: deploy|local` line for each affected code repository. `deploy` must correspond to the workspace's `test_branch`; `local` must specify, in the verification matrix, the command to start from the exact candidate worktree, the readiness, and how the test backend API-base is injected. Each `AC-xxx` row in `requirements.md` must appear in a task row (`T-xxx`), a local check row (`LV-xxx`), and a test check row (`TV-xxx`); plan rows must not cite criteria absent from the requirements, and task modification paths must not overlap.
6. Default to `fast-track` when all of the following conditions hold: existing capabilities are reused without changing their permission model; no new table structures/migrations; no new infrastructure, secrets, or major configuration; no public breaking contracts; risk is low/medium. Otherwise write `standard` and give the specific unmet items. The fast-track order is "implementation → executable targeted local checks → test delivery/acceptance → centralized Review → Gateway B"; standard keeps Review before test.
7. After the Orchestrator validates both documents, the single concrete risk, the single delivery lane, and the final route summary, it records `INIT → PLANNING` with the deterministic `transitionState`. Roles must not change progress directly.
8. Record `PLANNING → PLAN_REVIEWING`, resolve `lean-plan-reviewer` through the same routing (high/critical escalates it), and dispatch one independent Plan Reviewer in a fresh session that receives no Planner conversation. It reads the requirements, plan, and source and writes only the plan review section of `plan.md`. Parse its final `计划审核结论:` line, then record it with `node <plugin-root>/lib/cc-nexs-cli.mjs record-plan-review <id> --passed|--blocked [--finding "P0/P1: ..."]`. The controller binds the result to the current requirements/plan hash and persists the next state itself.
9. Only a blocked first round moves to `PLAN_REVIEW_BLOCKED`: dispatch the same Planner role once with the findings to revise both documents, record `PLANNING`, and run step 8 again. Every other result moves to `PLAN_PENDING_HUMAN`; open findings are shown at Gateway A for the human to decide. Do not add further review rounds. If a plan already waiting at `PLAN_PENDING_HUMAN` has no plan review for its current hash (for example, it was edited at the gate), run step 8 from that state.
10. Output the risk, delivery lane, key reuse points, plan review result with any open P0/P1 findings, plan files, and the HTML rendering entry point, then stop and wait for `/cc-nexs:approve-plan <id>`. Gateway A requires the plan review to be bound to the exact plan being approved and every acceptance criterion to trace to a task, a local check, and a test check; it binds risk, lane, and the requirements/plan scope hash together.

When high-risk permissions/payments/destructive migrations/public API breakage are present, the Planner sets `risk_tier` to high or critical (standard lane, escalated Reviewer). When one plan cannot be reviewed and verified as a whole, it recommends splitting the requirement into separately approved Lean requirements; it must not covertly add Review rounds.

When reusing the project's existing S3 presign/direct-upload capability without adding buckets, IAM/CORS, secrets, public permissions, or breaking APIs, do not automatically classify the work as high merely because the words "upload/S3/storage" appear. Only when those infrastructure, permission, or public contract aspects actually change should the risk be escalated accordingly.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
