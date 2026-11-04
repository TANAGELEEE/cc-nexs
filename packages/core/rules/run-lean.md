# Lean run orchestration

Read this file only when resolved mode is `lean`. Common identity, safety, model routing, workflow construction, persistence, and termination remain in `commands/run.md`.

## Lifecycle and delivery lane

`/cc-nexs:plan` owns `INIT -> PLANNING -> PLAN_REVIEWING -> PLAN_PENDING_HUMAN`, including the one independent plan review of a high/critical plan and at most one revision; a low/medium plan records a skipped review bound to its hash and goes to Gateway A. Run normally starts after `/cc-nexs:approve-plan` (or its `--auto` form for a feature initialized with `--auto-plan`) and must validate the current plan approval binding before dispatch.

Run implements the approved plan, records exact candidates, and invokes deterministic local verification. The approved `delivery_lane` selects ordering:

- `standard`: local verification → one consolidated Review → test integration/deployment → test verification → Gateway B.
- low/medium `fast-track`: local verification → test integration/deployment → test verification → one consolidated Review of the exact tested candidate → Gateway B.

High/critical plans may not use fast-track. In either lane `/cc-nexs:approve-release` binds the exact tested and reviewed fingerprint before base integration.

## Role → command dispatch table

| role/action | command |
|---|---|
| `lean-planner / draft_plan, revise_plan, revise_plan_for_gateway_b` | `/cc-nexs:plan <id>` (normally completed before run; scope feedback revision is the exception) |
| `lean-plan-reviewer / review_plan` | high/critical: independent `agents/lean-plan-reviewer.md`, then `record-plan-review`; low/medium: `record-plan-review --skipped --reason <text>` |
| `lean-developer / execute_plan` | `/cc-nexs:execute <id> --phase=implement` |
| `lean-developer / fix_review` | `/cc-nexs:execute <id> --phase=review-fix` |
| `lean-developer / fix_test` | `/cc-nexs:execute <id> --phase=test-fix` |
| `lean-developer / fix_gateway_b_feedback` | `/cc-nexs:execute <id> --phase=gateway-b-fix` |
| `lean-developer / sync_base` | `/cc-nexs:execute <id> --phase=base-sync` |
| `lean-developer / bind_derived` | `/cc-nexs:execute <id> --phase=bind-derived` |
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

When no local driver is configured, the parent Orchestrator—not a child role—runs `/cc-nexs:verify-local <id> --preflight`, then runs the plan-approved commands directly in each exact candidate worktree and records only their real results with `/cc-nexs:verify-local <id> --passed|--deferred-to-test|--failed` plus structured `--evidence-json`. A passing/deferred result must contain at least one actually executed passing item with non-empty `check`, the exact `command`, `exit_code: 0`, and non-empty `proof`. A failed result must contain an actually executed failed item with non-empty `check`, exact `command`, a non-zero integer `exit_code`, and concrete `proof`; it cannot include a deferred item or claim failure without execution. Do not record an assertion about a command that was not run, and do not invent success from expected output. The direct-evidence path is invalid when a configured driver exists.

Local verification stays a fast check before test acceptance. A matrix row whose command starts with `browser:` is run by the parent Orchestrator as `commands/verify-local.md` describes and recorded with `method: "browser"`, the exact matrix command, and concrete `proof`. A page that needs an undeployed backend change, or a parent without a browser provider or login, records that row as `deferred_to_test`.

A real compile/unit/lint failure is `failed`. Override the success transition exactly as follows; any other status is a controller failure and does not transition:

| action source state | `passed` / `deferred_to_test` effective next | `failed` effective next |
|---|---|---|
| `IMPLEMENTING` | `LOCAL_VERIFYING` | `LOCAL_VERIFY_FAILED` |
| `REVIEW_FIXING` or `TEST_FIXING` | `LOCAL_REVERIFYING` | `LOCAL_REVERIFY_FAILED` |
| `GATEWAY_B_FIXING` | `GATEWAY_B_LOCAL_REVERIFYING` | `LOCAL_REVERIFY_FAILED` |

The next state-machine pass routes the failure to the implementation/fix state selected by persisted `local_verification.context` (`REVIEW_FIXING`, `TEST_FIXING`, or `GATEWAY_B_FIXING`). Never exempt a failed command as an environment limitation and never apply the pre-action success state blindly.

An environment-only check may return Lean-only `deferred_to_test`. It continues exactly like `passed`, never redispatches the Developer merely because local backend startup or an external service is unavailable, and records each deferral as structured evidence with a stable exact check id, reason, and test execution plan. Hotfix-style unstructured text is not valid here.

Deferral covers only a check that could not run, or could not reach its assertions, because of the local environment. A check that ran and failed an assertion is `failed`, even when the same failure reproduces on the base commit; this applies equally to results produced by a configured driver. When a failure looks unrelated to the candidate, run the same command on the merge-base and record both results as proof. A base-reproducing failure is still `failed`: fix it inside the approved paths, or report it as a pre-existing base failure with that evidence so the user decides whether it is fixed on the base branch or brought into scope.

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
6. Test operations listed in the plan's pre-authorized section (for example a rebuild with rollback) are covered by Gateway A: run them without asking again. An unlisted operation is asked once. Integration work the plan's policy does not cover uses a `--target test-integration` amendment, never a new approval round.

Only after the release driver records success with pipeline, deployment, and exact environment revision evidence, run verification preflight:

- Freeze one callable browser provider for the attempt: Claude Code `chrome-devtools-mcp`; Codex current in-app/Chrome signed-in session; Pi ego lite when its runtime probe passes, otherwise the dedicated headless `@injaneity/pi-computer-use@0.4.3` Verifier with effective `browser_use: true` and `headless: true`. Never expose two providers to one child.
- Resolve deployed endpoints, restrict navigation to `release.test.allowed_hosts`, prove test—not production—and reuse existing login.
- If Web is approved as `local`, start only its recorded exact candidate worktree with the approved command, inject the deployed backend-java test endpoint/environment revision as API base, verify the combined flow, and always clean up the local process.
- Execute and structurally close every deferred check id.

With `derived_binding: before-final-test` in the approved plan, implementation and test-fix rounds leave the declared derived paths at their base values. Once a candidate passes Test, `nextStep()` returns `bind_derived`: the Developer runs only the declared generator, Custodian forms the candidate, run `node <plugin-root>/lib/cc-nexs-cli.mjs record-derived-binding <id>`, and local verification, Review and one final Test attempt follow the normal path. Later rounds regenerate those paths like source. A Test conflict on a path the policy marks "keep the Test side" is resolved with the Test branch version (`git checkout --ours -- <path>` in the conflict worktree) unless the candidate changes content Test must show; then regenerate it instead.

A test failure starts one repair round for all reported failures. Before a new test attempt, the repair must pass locally: a frontend-only fix is reproduced and confirmed with a `browser:` row or targeted test against the deployed test backend, and a backend fix with its targeted tests. Redeploy only once the round's fixes pass locally; a deployment is not the check for a fix that can run locally.

Unavailable browser, endpoint, login, MFA/CAPTCHA, or another verification capability after deployment calls `record-test-verification --manual-required --evidence "<missing capability and recovery step>"`. This enters `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY`, preserves deployment evidence, and lets the same attempt later record `--passed`. A manual run that records an actual blocked product result must route to test-fix, never wait forever in the manual state.

Missing test URLs/browser/login/bucket/CORS/IAM evidence cannot block the merge. A production-like URL, unsafe candidate, credential leak, missing deploy branch, or absent `release.test.driver` remains a delivery blocker; an absent `workflow.local_verify.driver` is handled by the direct-evidence fallback above.

`configure_auto_test_release` stops with exact fields needed to configure `release.test.driver`, restore `auto_if_ready`, and rerun. `--no-auto-test-release` is an external handoff, not a resumable evidence shortcut.

## Conclusion parsing and transitions

Read only the final relevant conclusion line in `plan.md`, using `^结论:\s*(\S+)` for Review and `^测试结论:\s*(\S+)` for test plus preset i18n literals. For a code Review, the `review.status` that `record-review --document-findings` derives decides PASS or FAIL when it differs from the line:

| Parse action | PASS / 通过 | FAIL / 阻塞 |
|---|---|---|
| `PARSE_PLAN_REVIEW` (`^计划审核结论:\s*(\S+)`) | `PLAN_PENDING_HUMAN` | first round `PLAN_REVIEW_BLOCKED`; later rounds `PLAN_PENDING_HUMAN` with open findings (`record-plan-review` persists this state) |
| `PARSE_CONSOLIDATED_REVIEW` | `CANDIDATE_READY` | `CONSOLIDATED_REVIEW_BLOCKED` |
| `PARSE_REVIEW_CLOSURE` | `CANDIDATE_READY` | `REVIEW_CLOSURE_BLOCKED -> HUMAN_INTERVENTION` |
| `PARSE_GATEWAY_B_DELTA_REVIEW` | `CANDIDATE_READY` then new test attempt | `GATEWAY_B_DELTA_REVIEW_BLOCKED -> HUMAN_INTERVENTION` |
| `PARSE_TEST_VERIFY` | `TEST_VERIFIED` | `TEST_VERIFY_FAILED` |

After every Review round (parallel Finders for the bound risk tier, then one Judge that reruns the P0/P1 commands), call `record-review --document-findings` to classify the `cc-nexs-review` block under `rules/review-findings.md` and bind the derived conclusion to the same candidate fingerprint as local verification. After test parse, call `record-test-verification` to bind the exact attempt/environment revision; parallel shard Verifiers are recorded together with `--shard-json`, which derives the conclusion and writes the merged acceptance section. Verifiers drive each repository through the guide `verify-guides` lists for it (in the candidate commit, else the docs repository's committed base, else the workspace). Complete Review occurs once; repairs use one delta closure. A test-blocked repair also requires new local verification and delta Review before a new test attempt.

Fast-track specifically routes a locally ready candidate directly through `CANDIDATE_READY -> TEST_RELEASE`; after `TEST_VERIFIED`, dispatch `review_tested_candidate`. The Review controller must prove the current verified attempt fingerprint equals the reviewed candidate. Standard lane reviews before `CANDIDATE_READY`.

## Human gateways and change requests

At `PLAN_PENDING_HUMAN`, print requirements scope, affected repositories, task waves, local/test validation matrices, risk/lane/release summary, the plan review result with any open P0/P1 findings, model profiles, and temporary HTML from `/cc-nexs:render-plan`; then stop for `/cc-nexs:approve-plan <id>`.

Before stopping at `RELEASE_PENDING_HUMAN`, run `node <plugin-root>/lib/cc-nexs-cli.mjs base-preflight <id>`. When it reports `base_changed` the task is already `BASE_CHANGED`: continue `sync_base` instead of asking for an approval release-base would reject. At `RELEASE_PENDING_HUMAN`, print candidate commits, consolidated Review result with unproven/advisory/rejected finding counts and unproven summaries, local fingerprint, test attempt/environment revision, deferred-check closure, AC coverage, and base targets; then stop for `/cc-nexs:approve-release <id>`. Approval authorizes the exact next base integration, non-force only.

Changes at Gateway B must use `/cc-nexs:request-release-changes <id> --type=... --feedback=...`; never edit code while remaining at the gate:

- `evidence`: update only plan execution/evidence, rerender, remain at Gateway B.
- `implementation`: `GATEWAY_B_CHANGE_REQUESTED -> GATEWAY_B_FIXING -> GATEWAY_B_LOCAL_REVERIFYING -> GATEWAY_B_DELTA_REVIEW`; PASS creates a new test attempt and regression evidence. A blocked delta goes to `HUMAN_INTERVENTION`.
- `scope`: `SCOPE_CHANGE_REQUESTED -> PLANNING -> PLAN_REVIEWING -> PLAN_PENDING_HUMAN`; Planner updates requirements plus plan approval scope, a fresh plan review is recorded for the new plan, and a new Gateway A hash is mandatory.

At `LOCAL_VERIFY_FAILED`, `LOCAL_REVERIFY_FAILED`, `TEST_MERGE_CONFLICT`, or `TEST_VERIFY_FAILED`, when the repair needs a decision the approved plan does not cover, run the same `scope` request instead of opening a new feature. It follows the same scope path and keeps the branch, worktrees, candidate history and the blocked attempt; local verification, Review and test delivery run again for the new candidate after Gateway A. Fixes inside the approved scope stay on their fix state.

Keep each request row synchronized with progress. A newer request marks the prior open row `addressed`; release approval marks the current row `approved` before archive.

## Same-AC amendments

More paths are not a human decision. Gateway A approves criteria and boundaries, so a repair that needs extra implementation, dependency, generated, or test-integration paths to close an approved AC continues without asking:

1. The Orchestrator records it from `IMPLEMENTING`, a local failure, `REVIEW_FIXING`, `TEST_MERGE_CONFLICT`, `TEST_VERIFY_FAILED`, or `TEST_FIXING`: `node <plugin-root>/lib/cc-nexs-cli.mjs amend-plan <id> --ac <AC> --path <path> --reason <why> [--target feature|test-integration]`. Collect the whole known path closure into one amendment rather than one per file.
2. Dispatch an independent `lean-plan-reviewer` on that amendment only, then run `record-amendment-review <id> --amendment <A-n> --passed|--blocked [--finding "P1: ..."]`.
3. Passed: the Developer may touch those paths and the current state continues. Blocked: use the `scope` request.

The ledger lives in `plan_amendments` and the plan's change log, outside `APPROVAL-SCOPE`, so the Gateway A binding and existing evidence stay valid; a new candidate still needs its own local verification, Review, and test evidence.

Use `scope` instead when the repair adds or edits an AC, crosses a stated non-goal, weakens a local or test check, changes permissions, schema or migrations, adds infrastructure or secrets, breaks a public contract, adds a repository, or acts on production.

## Base release and completion

After exact Gateway B approval, transition to `BASE_MERGING`, invoke `/cc-nexs:release-base`, and automatically continue `sync_base` on changed-base/conflict results; protected-branch failures still require PR/MR handoff. Integrate only the bound code candidates. Protected bases merge through the configured MR driver from the assigned feature branch at the exact candidate; a pending MR stays `BASE_MERGING` and release-base is rerun. After success record `COMPLETE`, then run `node <plugin-root>/lib/cc-nexs-cli.mjs finalize-docs <id>`: it creates the final five-file docs candidate (`requirements.md`, `plan.md`, `config.json`, `progress.md`, `progress.json`), integrates docs last, proves remote ancestry, and cleans the docs worktree and branches. Rerun it while it reports `pending`. Do not write docs after that final candidate.
