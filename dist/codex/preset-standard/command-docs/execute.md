---
description: "Lean implementation entry point. Implements in parallel by plan task and path ownership; not responsible for Git mutation."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep, Task"
argument-hint: "[requirement ID] [--phase=implement|review-fix|test-fix|gateway-b-fix|base-sync]"
---

# /cc-nexs:execute

Only for `mode=lean` with an approved plan. Read the plan task DAG and dispatch independent `lean-developer`s by wave:

- Before dispatching any child, resolve and freeze all Developer runtimes for this round from the same approved plan/progress/config snapshot; starting a wrong model first and then aborting to re-dispatch is forbidden.
- Print and verify each frozen result's `{runtime, role, profile, model, effort|reasoning_effort|thinking, fallback}`; if the actual child parameters do not match, dispatch must be refused before any writes. A role is not interrupted by documentation revision changes during execution; it re-resolves only at the next phase boundary.
- Only tasks whose allowed modification paths do not overlap may run in parallel; overlapping tasks run serially.
- Each child receives only its own AC, task, worktree, allowed paths, and verification commands.
- Children are forbidden from Git mutation and return only exact modified paths and check results.
- The Orchestrator validates each child's paths; after all implementation waves for the same repository are complete, call Git Custodian once to form a single candidate — do not repeatedly commit candidates per task/wave. The feature branch for each repository is fixed as `feature/<id>-<slug>`.
- Do not keep chasing the latest base. Use Custodian prepare only when overlapping paths, conflicts, or known contract dependencies require synchronization; re-verify the changed candidate. Non-overlapping base updates are integrated by release-base and do not change an accepted candidate.
- `review-fix` handles only P0/P1 numbers from the consolidated Review; `test-fix` handles only test-environment failures; incidental refactoring is forbidden.
- `gateway-b-fix` handles only the ACs and allowed paths of the current Gateway B implementation request in `plan.md`; if requirement/AC/approved-plan changes are found, stop and switch to a scope request.

Fast-track constraints:

- Run only the targeted checks specified by the plan, preferring to reuse/extend the most recent existing tests; do not add new test files unless there is no existing file where the key regression can live.
- Record the same confirmed baseline Maven/Nexus/external-dependency blocker only once; do not repeatedly download, re-run, or have multiple children prove it again.
- Real compile/unit/lint failures must be fixed; only start/smoke/E2E that explicitly depend on locally unavailable infrastructure may be recorded as `deferred_to_test` per the driver contract, with the test action written out. Code failures must not be disguised as deferred.
- When no local driver is configured, do not add one-off project scripts: the parent Orchestrator runs the plan-approved commands directly and binds the real command/exit_code/proof with `verify-local --passed|--deferred-to-test --evidence-json`; at least one command must actually pass.
- Do not refactor outside the ACs, generalize, or "harden along the way." If an improvement is worth doing but not required, record a follow-up and continue with the current delivery.

Any change to requirements or `APPROVAL-SCOPE` invalidates the Plan Gate; stop.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
