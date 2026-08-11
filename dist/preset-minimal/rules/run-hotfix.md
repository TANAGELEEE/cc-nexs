# Hotfix run orchestration

Read this file only when resolved mode is `hotfix`. Common identity, safety, model routing, workflow construction, persistence, and termination remain in `commands/run.md`.

## Lifecycle

`/cc-nexs:hotfix` binds `hotfix.md` scope and owns `INIT -> HOTFIX_IMPLEMENTING`. Run then performs deterministic local verification, one consolidated Review, test release with explicit Hotfix authority, independent environment verification, Gateway B, and exact base integration.

P3 may skip Review only after deterministic machine boundary proof. P0/P1 automatically routes Reviewer to `escalated` and must retain rollback evidence. Scope expansion is forbidden: evidence/implementation feedback may update `hotfix.md`; contract/scope feedback becomes a new Lean/Full change.

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

`assert_p3_candidate` invokes deterministic `cc-nexs assert-hotfix-candidate <id>`. If blocked, re-read progress and stop at `HOTFIX_P3_BOUNDARY_BLOCKED`; never apply a stale candidate-ready transition.

## Verification, release, and retries

Local verification is mandatory and may not use Lean `deferred_to_test`. Branch on the deterministic controller result instead of blindly applying the pre-action success transition:

| action source state | `passed` effective next | `failed` effective next |
|---|---|---|
| `HOTFIX_IMPLEMENTED` | `HOTFIX_LOCAL_VERIFYING` | `HOTFIX_LOCAL_VERIFY_FAILED` |
| `HOTFIX_FIXING` | `HOTFIX_LOCAL_REVERIFYING` | `HOTFIX_LOCAL_REVERIFY_FAILED` |

Any other result stops as a controller failure. A local failure returns through the Hotfix fix state; environment inability is a real Hotfix block unless the check is explicitly post-deployment verification.

Apply the common release safety boundary. `release_test_hotfix` is valid only from `HOTFIX_TEST_RELEASE` and always passes `--hotfix`. Start CI/CD once. A `pending` driver result persists `deploying`, reports the pipeline, and returns. `poll_test_release` invokes `/cc-nexs:release-test <id> --hotfix --resume` once; it never merges or triggers twice. Deliberate recovery from a failed release uses `--hotfix --retry`.

Browser/URL/login and similar verification capabilities are checked only after deployment and use the runtime-provider, allowed-host, test-identity, and credential rules from the common controller. If unavailable, record `manual_required` on the deployed attempt; later pass/blocked evidence resumes that same attempt. A genuine blocked product result routes to `HOTFIX_TEST_FAILED`, not an infinite manual wait.

`configure_auto_test_release` prints the missing driver/policy and returns. Manual G2 cannot stand in for Hotfix test evidence or Gateway B.

## Conclusion parsing and circuit limits

| Parse action | PASS | BLOCKED |
|---|---|---|
| `PARSE_HOTFIX_REVIEW` | `HOTFIX_CANDIDATE_READY` | `HOTFIX_REVIEW_BLOCKED` |
| `PARSE_HOTFIX_DELTA_REVIEW` | `HOTFIX_CANDIDATE_READY` | `HOTFIX_DELTA_REVIEW_BLOCKED -> HUMAN_INTERVENTION` |
| `PARSE_HOTFIX_TEST` | `HOTFIX_TEST_VERIFIED` | `HOTFIX_TEST_FAILED` |

Use only the final `hotfix.md` Review/Test conclusion and preset i18n literals. `record-review` binds exact candidates; `record-test-verification` binds exact attempt/environment revision. Only one delta Review is allowed for the lifecycle.

Every blocked Hotfix test increments `counters.fix_per_bug.HOTFIX_TEST`. The mode threshold is 1: the first failure permits the single fix/local-verify/delta/release loop; the second failure, or another fix after delta consumption, goes to `HUMAN_INTERVENTION`. `HOTFIX_P3_BOUNDARY_BLOCKED` requires a new P0/P1/P2 Hotfix or Lean/Full feature.

## Human gateway and completion

At `HOTFIX_RELEASE_PENDING_HUMAN`, print severity and scope hash, exact candidate, local evidence, Review or P3 skip proof, test attempt/environment revision, P0/P1 rollback proof, and base targets. Stop for `/cc-nexs:approve-release <id>`.

After approval transition to `HOTFIX_BASE_MERGING`, invoke deterministic base release, and record `COMPLETE` only after exact-candidate proof. Integrate docs last and perform no artifact writes after the final docs candidate.
