# Lean run orchestration

Read this file only when resolved mode is `lean`. Common identity, safety, model routing, workflow construction, persistence, and termination remain in `commands/run.md`.

## Lifecycle and delivery lane

`/cc-nexs:plan` owns `INIT -> PLANNING -> PLAN_PENDING_HUMAN`; run normally starts after `/cc-nexs:approve-plan` and must validate the current plan approval binding before dispatch.

Run implements the approved plan, records exact candidates, and invokes deterministic local verification. The approved `delivery_lane` selects ordering:

- `standard`: local verification → one consolidated Review → test integration/deployment → test verification → Gateway B.
- low/medium `fast-track`: local verification → test integration/deployment → test verification → one consolidated Review of the exact tested candidate → Gateway B.

High/critical plans may not use fast-track. In either lane `/cc-nexs:approve-release` binds the exact tested and reviewed fingerprint before base integration.

## Role → command dispatch table

| role/action | command |
|---|---|
| `lean-planner / draft_plan, revise_plan_for_gateway_b` | `/cc-nexs:plan <id>` (normally completed before run; scope feedback revision is the exception) |
| `lean-developer / execute_plan` | `/cc-nexs:execute <id> --phase=implement` |
| `lean-developer / fix_review` | `/cc-nexs:execute <id> --phase=review-fix` |
| `lean-developer / fix_test` | `/cc-nexs:execute <id> --phase=test-fix` |
| `lean-developer / fix_gateway_b_feedback` | `/cc-nexs:execute <id> --phase=gateway-b-fix` |
| `lean-developer / sync_base` | `/cc-nexs:execute <id> --phase=base-sync` |
| `lean-reviewer / review_candidate` | `/cc-nexs:lean-review <id>` |
| `lean-reviewer / review_tested_candidate` | `/cc-nexs:lean-review <id>` with current attempt/environment evidence |
| `lean-reviewer / review_delta` | `/cc-nexs:lean-review <id> --closure` |
| `lean-reviewer / review_gateway_b_delta` | `/cc-nexs:lean-review <id> --gateway-b-delta` |
| `lean-verifier / verify_test, verify_test_regression` | `/cc-nexs:lean-verify <id>` |
| `verify_local` | deterministic `/cc-nexs:verify-local <id>` |
| `release_base` | deterministic `/cc-nexs:release-base <id>` |

`release_test` is a parent control action. Invoke `/cc-nexs:release-test <id>` once for an immutable candidate; after failure only an explicit retry adds `--retry`.

## Local verification and bounded repair

`verify_local` must invoke the deterministic controller. When `workflow.local_verify.driver` exists, call `/cc-nexs:verify-local <id>` normally and let that driver execute the bound candidate checks.

When no local driver is configured, the parent Orchestrator—not a child role—runs the plan-approved commands directly in each exact candidate worktree and records only their real results with `/cc-nexs:verify-local <id> --passed|--deferred-to-test|--failed` plus structured `--evidence-json`. A passing/deferred result must contain at least one actually executed passing item with non-empty `check`, the exact `command`, `exit_code: 0`, and non-empty `proof`. A failed result must contain an actually executed failed item with non-empty `check`, exact `command`, a non-zero integer `exit_code`, and concrete `proof`; it cannot include a deferred item or claim failure without execution. Do not record an assertion about a command that was not run, and do not invent success from expected output. The direct-evidence path is invalid when a configured driver exists.

A real compile/unit/lint failure is `failed`. Override the success transition exactly as follows; any other status is a controller failure and does not transition:

| action source state | `passed` / `deferred_to_test` effective next | `failed` effective next |
|---|---|---|
| `IMPLEMENTING` | `LOCAL_VERIFYING` | `LOCAL_VERIFY_FAILED` |
| `REVIEW_FIXING` or `TEST_FIXING` | `LOCAL_REVERIFYING` | `LOCAL_REVERIFY_FAILED` |
| `GATEWAY_B_FIXING` | `GATEWAY_B_LOCAL_REVERIFYING` | `LOCAL_REVERIFY_FAILED` |

The next state-machine pass routes the failure to the implementation/fix state selected by persisted `local_verification.context` (`REVIEW_FIXING`, `TEST_FIXING`, or `GATEWAY_B_FIXING`). Never exempt a failed command as an environment limitation and never apply the pre-action success state blindly.

An environment-only check may return Lean-only `deferred_to_test`. It continues exactly like `passed`, never redispatches the Developer merely because local backend startup or an external service is unavailable, and records each deferral as structured evidence with a stable exact check id, reason, and test execution plan. Hotfix-style unstructured text is not valid here.

Every deferred id becomes mandatory evidence in test. Close it only with structured evidence equivalent to:

```text
--evidence-json '{"check":"<exact-id>","result":"passed","proof":"<request/result/artifact>"}'
```

A matching id in prose, skipped/not-executed evidence, or failed/blocked result does not close the deferral.

Review findings caused only by an explicitly deferred environment check are not P1 implementation defects. The Reviewer still checks code paths, contracts, candidate integrity, and available deterministic evidence. One complete Review is allowed; a repair gets at most one independent delta closure.

## Test delivery and post-deploy verification

Apply the common delivery-safety preflight in `commands/run.md`, plus the approved plan topology:

1. Every assigned code repository must have exact `test_delivery.<repo>: deploy|local` in a new-plan approval binding. Legacy approved plans retain their recorded compatibility behavior.
2. A `deploy` repository must have `test_branch`; integrate it normally and non-force. A `local` repository stays in the immutable fingerprint but is not pushed. At least one repository must deploy.
3. Local candidates must be their recorded clean worktrees on the recorded branch and exact candidate commit, including no untracked files.
4. Start CI/CD once. `pending` persists `delivery.test.status=deploying` and a pipeline reference. Return immediately; a later run's `poll_test_release` invokes `--resume` once and neither reintegrates nor retriggers.
5. A failed deployment may be deliberately retried with `--retry`; it creates a new attempt but does not turn the first successful deployment into “regression” verification.

Only after the release driver records success with pipeline, deployment, and exact environment revision evidence, run verification preflight:

- Freeze one callable browser provider for the attempt: Claude Code `chrome-devtools-mcp`; Codex current in-app/Chrome signed-in session; Pi ego lite when its runtime probe passes, otherwise the dedicated headless `@injaneity/pi-computer-use@0.4.3` Verifier with effective `browser_use: true` and `headless: true`. Never expose two providers to one child.
- Resolve deployed endpoints, restrict navigation to `release.test.allowed_hosts`, prove test—not production—and reuse existing login.
- If Web is approved as `local`, start only its recorded exact candidate worktree with the approved command, inject the deployed backend-java test endpoint/environment revision as API base, verify the combined flow, and always clean up the local process.
- Execute and structurally close every deferred check id.

Unavailable browser, endpoint, login, MFA/CAPTCHA, or another verification capability after deployment calls `record-test-verification --manual-required --evidence "<missing capability and recovery step>"`. This enters `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY`, preserves deployment evidence, and lets the same attempt later record `--passed`. A manual run that records an actual blocked product result must route to test-fix, never wait forever in the manual state.

Missing test URLs/browser/login/bucket/CORS/IAM evidence cannot block the merge. A production-like URL, unsafe candidate, credential leak, missing deploy branch, or absent `release.test.driver` remains a delivery blocker; an absent `workflow.local_verify.driver` is handled by the direct-evidence fallback above.

`configure_auto_test_release` stops with exact fields needed to configure `release.test.driver`, restore `auto_if_ready`, and rerun. Legacy G2 approval cannot impersonate an immutable Lean release attempt or unlock Gateway B. `--no-auto-test-release` is an external handoff, not a resumable evidence shortcut.

## Conclusion parsing and transitions

Read only the final relevant conclusion line in `plan.md`, using `^结论:\s*(\S+)` for Review and `^测试结论:\s*(\S+)` for test plus preset i18n literals:

| Parse action | PASS / 通过 | FAIL / 阻塞 |
|---|---|---|
| `PARSE_CONSOLIDATED_REVIEW` | `CANDIDATE_READY` | `CONSOLIDATED_REVIEW_BLOCKED` |
| `PARSE_REVIEW_CLOSURE` | `CANDIDATE_READY` | `REVIEW_CLOSURE_BLOCKED -> HUMAN_INTERVENTION` |
| `PARSE_GATEWAY_B_DELTA_REVIEW` | `CANDIDATE_READY` then new test attempt | `GATEWAY_B_DELTA_REVIEW_BLOCKED -> HUMAN_INTERVENTION` |
| `PARSE_TEST_VERIFY` | `TEST_VERIFIED` | `TEST_VERIFY_FAILED` |

After every Review parse, call `record-review` to bind the conclusion to the same candidate fingerprint as local verification. After test parse, call `record-test-verification` to bind the exact attempt/environment revision. Complete Review occurs once; repairs use one delta closure. A test-blocked repair also requires new local verification and delta Review before a new test attempt.

Fast-track specifically routes a locally ready candidate directly through `CANDIDATE_READY -> TEST_RELEASE`; after `TEST_VERIFIED`, dispatch `review_tested_candidate`. The Review controller must prove the current verified attempt fingerprint equals the reviewed candidate. Standard lane reviews before `CANDIDATE_READY`.

## Human gateways and change requests

At `PLAN_PENDING_HUMAN`, print requirements scope, affected repositories, task waves, local/test validation matrices, risk/lane/release summary, model profiles, and temporary HTML from `/cc-nexs:render-plan`; then stop for `/cc-nexs:approve-plan <id>`.

At `RELEASE_PENDING_HUMAN`, print candidate commits, consolidated Review result, local fingerprint, test attempt/environment revision, deferred-check closure, AC coverage, and base targets; then stop for `/cc-nexs:approve-release <id>`. Approval authorizes the exact next base integration, non-force only.

Changes at Gateway B must use `/cc-nexs:request-release-changes <id> --type=... --feedback=...`; never edit code while remaining at the gate:

- `evidence`: update only plan execution/evidence, rerender, remain at Gateway B.
- `implementation`: `GATEWAY_B_CHANGE_REQUESTED -> GATEWAY_B_FIXING -> GATEWAY_B_LOCAL_REVERIFYING -> GATEWAY_B_DELTA_REVIEW`; PASS creates a new test attempt and regression evidence. A blocked delta goes to `HUMAN_INTERVENTION`.
- `scope`: `SCOPE_CHANGE_REQUESTED -> PLANNING -> PLAN_PENDING_HUMAN`; Planner updates requirements plus plan approval scope and a new Gateway A hash is mandatory.

Keep each request row synchronized with progress. A newer request marks the prior open row `addressed`; release approval marks the current row `approved` before archive.

## Base release and completion

After exact Gateway B approval, transition to `BASE_MERGING`, invoke `/cc-nexs:release-base`, and stop on changed-base or protected-branch failure. Integrate only the bound code candidates. After success record `COMPLETE`, then Git Custodian creates the final five-file docs candidate (`requirements.md`, `plan.md`, `config.json`, `progress.md`, `progress.json`), integrates docs last, proves remote ancestry, and cleans feature worktrees/refs. Do not write docs after that final candidate.
