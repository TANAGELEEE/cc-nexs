---
description: "Lean default-mode planning entry point. Parallel read-only research, producing a single requirements.md and plan.md, and stopping at Gateway A."
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
   It must also write one machine-parsable `- test_delivery.<repo-id>: deploy|local` line for each affected code repository. `deploy` must correspond to the workspace's `test_branch`; `local` must specify, in the verification matrix, the command to start from the exact candidate worktree, the readiness, and how the test backend API-base is injected. Each AC must cover a task, a minimal local check, and a test check, and task modification paths must not overlap.
6. Default to `fast-track` when all of the following conditions hold: existing capabilities are reused without changing their permission model; no new table structures/migrations; no new infrastructure, secrets, or major configuration; no public breaking contracts; risk is low/medium. Otherwise write `standard` and give the specific unmet items. The fast-track order is "implementation → executable targeted local checks → test delivery/acceptance → centralized Review → Gateway B"; standard keeps Review before test.
7. After the Orchestrator validates both documents, the single concrete risk, the single delivery lane, and the final route summary, it records `INIT → PLANNING → PLAN_PENDING_HUMAN` with the deterministic `transitionState`. Roles must not change progress directly. High/critical risk only affects subsequent Reviewer routing or a Full recommendation; it must not automatically open another round of agents during the Plan phase.
8. Output the risk, delivery lane, key reuse points, plan files, and the HTML rendering entry point, then stop and wait for `/cc-nexs:approve-plan <id>`. Gateway A binds risk, lane, and the requirements/plan scope hash together.

When high-risk permissions/payments/destructive migrations/public API breakage cannot be controlled with a single centralized Review, the Planner must recommend explicitly switching to full and must not covertly add Review rounds.

When reusing the project's existing S3 presign/direct-upload capability without adding buckets, IAM/CORS, secrets, public permissions, or breaking APIs, do not automatically classify the work as high merely because the words "upload/S3/storage" appear. Only when those infrastructure, permission, or public contract aspects actually change should the risk be escalated accordingly.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
