---
description: "Lean test environment black-box acceptance, aggregating AC evidence directly into plan.md."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Task, mcp__chrome-devtools__*"
argument-hint: "[requirement ID]"
---

# /cc-nexs:lean-verify

Dispatch an independent `lean-verifier` only after a successful test release, using the resolved runtime model profile. The parent Orchestrator injects the complete structured deferral list from the local verification attempt at the current exact fingerprint; following the Test environment acceptance matrix in `plan.md`, it runs every P0/P1 check, all cross-platform paths, and all `deferred_to_test` checks, accessing only `allowed_hosts`. Each deferred item must be closed precisely with `--evidence-json '{"check":"<exact-id>","result":"passed","proof":"<request/result/artifact>"}'`; free-text matches, skipped results, and failed results cannot pass the controller.

A Web candidate whose Test delivery topology is marked `local` does not need a `test_branch`: start it locally from its exact candidate worktree using the command in the plan, point the API base at the test backend that has already been deployed and whose environment revision is frozen, then perform black-box acceptance through the allowed localhost and test host. Do not replace the local Web with the main checkout that is not bound to the candidate.

Write the results into `plan.md`; do not create test-cases/test-report/acceptance/BUG documents. The parent Orchestrator calls `recordTestVerification()` to bind the results to the current attempt/environment revision: a pass moves to `TEST_VERIFIED`, a genuine product failure moves to `TEST_VERIFY_FAILED`. If deployment has succeeded but the browser, login/MFA, manual environment configuration, or other acceptance capabilities are unavailable, call `record-test-verification --manual-required` to enter the recoverable `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY`; do not treat this as a code failure, and do not roll back the completed test delivery. After manual evidence is supplied, the same attempt can record passed and continue.

## Human-input blockers

Before `record-test-verification --manual-required`, provide `--evidence-json` containing `type: "human_input_required"` and nonempty `check`, `reason`, `attempted`, `required_input`, and `resume_action` strings. Unfinished executable checks must continue; they are not missing human capability. Ask for the specific missing permission, login action, data or external capability immediately, without plaintext credentials. Preserve completed checks and resume the same deployed attempt when input arrives. The controller persists the verification result state; re-read it before continuing Review and release readiness.

For a pre-existing defect blocking acceptance, first compare baseline/candidate reproduction and obtain independent attribution review; continue unaffected checks and try an equivalent approved representative. Do not fix unrelated product scope or mark unexecuted checks passed. If human input is still necessary, record `cause: "pre_existing_defect"` with `baseline_commit`, `baseline_proof`, `candidate_proof`, `impact`, `alternative_attempted`, `tracking`, `review_proof` in addition to the required blocker fields. Ask for working conditions or explicit acceptance of the specific coverage gap. Existing exact-candidate release exception gates remain authoritative.
