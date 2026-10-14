# Hotfix run orchestration

Read this file only when resolved mode is `hotfix`. Common identity, safety, model routing, workflow construction, persistence, and termination remain in `commands/run.md`.

## Lifecycle

`/cc-nexs:hotfix` initializes a repair through `init-hotfix`, binds the assigned BUG document, and owns `INIT -> HOTFIX_IMPLEMENTING`. New repairs use `hotfix/<key>`, `.worktrees/<key>/<repo>/`, and local machine state in `.cc-nexs/hotfixes/<key>/`; they never reserve a feature number or publish placeholders. Resolve the document through `progress.hotfix_document`; legacy tasks retain `hotfix.md` and their existing state location.

Run performs local verification, independent consolidated Review for every severity including P3, exact-candidate test delivery, independent verification, Gateway B, and base integration. P3 file/line counts are risk hints, not a behavioral proof or a Review exemption. P0/P1 routes Reviewer to `escalated` and requires affected ACs plus rollback owner/steps in the bound scope.

## Role → command dispatch table

| role/action | dispatch |
|---|---|
| `hotfix-developer / implement_hotfix, fix_hotfix, fix_local, sync_base` | `agents/hotfix-developer.md` in its assigned worktree |
| `hotfix-reviewer / review_hotfix` | independent `agents/hotfix-reviewer.md`, then `record-review` |
| `hotfix-reviewer / review_hotfix_delta` | independent delta session, then `record-review --closure` |
| `hotfix-verifier / verify_hotfix_*` | `agents/hotfix-verifier.md`, then `record-test-verification` |
| `verify_local` | deterministic `/cc-nexs:verify-local <id>` |
| `release_test_hotfix` | deterministic `/cc-nexs:release-test <id> --hotfix` |
| `release_base` | deterministic `/cc-nexs:release-base <id>` |

For every role dispatch, set `CC_NEXS_PROGRESS_FILE` to the absolute authoritative progress file and `BUG_FILE` to the resolved BUG path; private machine-state directories are not document directories.

`<id>` accepts the new bug-key or a legacy Hotfix id. Never use `assert-hotfix-candidate` as authority to skip Review. If a legacy task is stopped at `HOTFIX_P3_BOUNDARY_BLOCKED`, record its already-authorized revision with `revise-hotfix`; do not allocate another feature id.

## Verification, release, and retries

Local verification is mandatory. Run the configured driver; without one, execute the exact commands in the bound scope's local verification matrix and pass structured results to `verify-local --passed|--failed --evidence-json`. Both paths require check/command/exit_code/proof/result, exact command matching, and coverage of every bound check. Hotfix never uses `deferred_to_test`.

| action source state | `passed` effective next | `failed` effective next |
|---|---|---|
| `HOTFIX_IMPLEMENTED` | `HOTFIX_LOCAL_VERIFYING` | `HOTFIX_LOCAL_VERIFY_FAILED` |
| `HOTFIX_FIXING` | `HOTFIX_LOCAL_REVERIFYING` | `HOTFIX_LOCAL_REVERIFY_FAILED` |

Re-read the deterministic result before persisting a transition. A local failure returns through the fix state; a missing driver alone does not require new project infrastructure. Never bypass the bound matrix, relabel a command failure, or fabricate test evidence.

Apply the common release safety boundary. `release_test_hotfix` is valid only from `HOTFIX_TEST_RELEASE` with `--hotfix`. Trigger CI/CD once. A pending result persists `deploying`; `/cc-nexs:release-test <id> --hotfix --resume` only polls the existing attempt. Deliberate retry of a failed release uses `--hotfix --retry`.

Browser/URL/login limitations are post-deployment verification issues. Record `manual_required` on the actual deployed attempt so later evidence can resume it. A product verification failure routes to `HOTFIX_TEST_FAILED` and cannot become an environment exception. Manual G2 cannot stand in for Hotfix evidence or Gateway B.

## Conclusions and scope revisions

| Parse action | PASS | BLOCKED |
|---|---|---|
| `PARSE_HOTFIX_REVIEW` | `HOTFIX_CANDIDATE_READY` | `HOTFIX_REVIEW_BLOCKED` |
| `PARSE_HOTFIX_DELTA_REVIEW` | `HOTFIX_CANDIDATE_READY` | `HOTFIX_DELTA_REVIEW_BLOCKED -> HUMAN_INTERVENTION` |
| `PARSE_HOTFIX_TEST` | `HOTFIX_TEST_VERIFIED` | `HOTFIX_TEST_FAILED` |

Read the final Review/Test conclusion from the assigned BUG document. `record-review` binds exact candidates; `record-test-verification` binds attempt and environment revision. Retain the existing single delta Review limit and test-failure circuit breaker; do not add quotas or reset counters by hand.

For an authorized revision of the same fault's paths, severity, or verification matrix, use `revise-hotfix <id> --reason <text> --authorization-evidence <text>`. This rebinds scope in the original key/branch, invalidates current evidence and approval, and retains history. Existing user authorization is recorded without adding a new confirmation round. Contract/schema/permission expansion uses `--promote-lean`: create `<BUGstem>.lean/` beside the original BUG, migrate active state there, retain a local `progress.hotfix-history.json`, and return to Lean planning and Gateway A before implementation.

## Human gateway and completion

At `HOTFIX_RELEASE_PENDING_HUMAN`, show severity/scope hash, exact candidate, passed local evidence and independent Review, test attempt/environment revision, rollback proof, and base targets. Invoke `/cc-nexs:approve-release <id>` only with user authorization.

An explicitly authorized environment exception uses that same Gateway B: `approve-release --test-exception --authorization-evidence <text> --reason <text> --environment-evidence <text> --rollback-evidence <text>`. It requires the same candidate's passed local evidence and Review plus a real test deployment with `manual_required`. Preserve the unverified test fact. This exception authorizes configured base integration only, not production deployment; absent deployment, product test failure, and missing evidence remain blocking.

After approval, use deterministic base release and mark `COMPLETE` only after exact-candidate proof. Integrate docs last. For new Hotfix tasks, commit only the assigned BUG document; keep machine files in `.cc-nexs/hotfixes/<key>/`. Legacy tasks retain their original document/state collection. Perform no artifact writes after the final docs candidate.
