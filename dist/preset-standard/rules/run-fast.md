# Fast and legacy Lite run orchestration

Read this file only when resolved mode is `fast` or legacy `lite`. Common identity, safety, model routing, workflow construction, persistence, and termination remain in `commands/run.md`.

## Lifecycle and Role → command dispatch table

Fast folds recon/spec/build into Fullstack, then separates code Review, test delivery/verification, and acceptance.

| role/action | command |
|---|---|
| `fullstack / draft_spec, revise_spec` | `/cc-nexs:fullstack <id> --phase=spec` |
| `fullstack / implement` | ownership v1: one `/cc-nexs:fullstack <id> --phase=build --assignment=<IMP-id>` per Assignment, then one `--phase=build-sync`; legacy v0: `/cc-nexs:fullstack <id> --phase=build` |
| `fullstack / revise_implementation` | `/cc-nexs:fullstack <id> --phase=review-fix` |
| `fullstack / fix_bug` | `/cc-nexs:fullstack <id> --phase=fix --bug=<BUG-ID>` |
| `reviewer / review_spec` | `/cc-nexs:review spec <id>` |
| `reviewer / review_code` | `/cc-nexs:review code <id>`; writes only `sa-code-review.md` |
| `reviewer / accept` | `/cc-nexs:review accept <id>`; writes only `acceptance.md` |
| `verifier / write_cases, run, verify_initial` | `/cc-nexs:verify initial <id>` |
| `verifier / regression, verify_regression` | `/cc-nexs:verify regression <id>` |

Always perform best-effort README sync before the spec human gate and after transitions.

## Multi-end implementation fanout

When `nextStep()` returns `fanout: implementation_repositories`:

1. Run deterministic `validate-implementation-plan`. An approved v1 binding must match the current spec exactly. Missing binding/ownership on a historical feature is the only single-worker fallback; a present malformed table fails closed.
2. Resolve `implementationWaves()` for M1 and freeze one coherent Fullstack model/effort/fallback snapshot before the first child. Do not recompute, interrupt, or replace a worker after siblings have started.
3. Before each bounded batch, run parent-only `implementation-delta begin <id>` with one `--assignment` for every batch member and retain its opaque token. Fast supplies no docs allowance, so the controller requires the assigned docs worktree and every inactive code worktree to remain unchanged. Then launch all batch members together as fresh Fullstack children, each with its exact Assignment, assigned repository worktree, AC subset, Allowed paths, and Validation. Claude/Codex spawn all before awaiting. Pi makes one `subagent({ tasks, concurrency, async: true, worktree: false, context: "fresh" })` call for the wave and joins it with `subagent_wait({ id })`. Never expose the token, use nested agents, or create Pi worktrees.
4. Only different repositories may share a wave. A worker is code-only and cannot write shared docs. Wait for the complete batch and always run `implementation-delta end <id> --token <token>` before retrying a failed member or starting another batch/wave. The deterministic tree delta—not child-reported paths—must prove every active repository stayed inside its Assignment and every inactive ownership repository stayed unchanged. A failed or out-of-scope worker blocks BUILD; completed siblings are not arbitrarily rerun.
5. After every worker succeeds, run aggregate build/test/lint once per changed repository (repositories may run in parallel). Then invoke exactly one `/cc-nexs:fullstack <id> --phase=build-sync` for dev-plan/api-doc/deploy.
6. No child completion creates a candidate. After the join, shared-doc sync, and aggregate verification, Git Custodian serially creates or refreshes exactly one candidate per changed repository. Only then may `SPEC_APPROVED -> BUILD` complete.

The G1 summary must show Assignment, repository, AC, wave, and dependency rows so the human approves the actual parallel boundary.

## Human gates and test delivery

At `SPEC_PENDING_HUMAN`, sync README first, then print feature/branch/mode, spec background and approach, AC table, final spec-review conclusion, and tradeoffs. Stop for the configured approve/revise action.

For `auto_if_ready`, a passing code Review enters `TEST_RELEASE`. Apply the common delivery safety boundary, invoke `/cc-nexs:release-test <id>` once, persist and resume `pending` without duplicate merge/trigger, then perform post-deploy verification. Missing browser/URL/login is `manual_required` on the deployed attempt, not a pre-push block. Retry only a failed attempt with `--retry`.

For explicit manual/disabled or legacy `per_sprint`, use `DEPLOY_GATE`. The G2 summary includes feature/branch/mode, optional sprint, code-review conclusion, candidate log, and database changes. It attests that the complete candidate (or legacy sprint) was integrated to test and required environment checks ran. Stop for `/cc-nexs:approve-deploy <id>`. G2 never authorizes production.

## fast 模式解析

Apply regex only to the last 30 lines and use preset i18n literals.

### `PARSE_CODE_REVIEW`

Read only `sa-code-review.md`:

| result | next | counter |
|---|---|---|
| PASS + `auto_if_ready` | `TEST_RELEASE` | reset review loop |
| PASS + manual/legacy | `DEPLOY_GATE` | reset review loop |
| NEEDS_REVISION | `CODE_REVIEW_NEEDS_REVISION` | `review_revision++` |

### Test and acceptance

- From `TEST`, `test-report.md` pass → `TEST_PASSED`; blocked → `TEST_BLOCKED`.
- `PARSE_FIX_REVIEW` PASS records new candidates then returns to `TEST_RELEASE`; NEEDS_REVISION → `FIX_REVIEW_NEEDS_REVISION` and implementation/review repeats.
- Release verification round greater than one uses only `verify regression`; local verification cannot replace deployed regression.
- `PARSE_ACCEPTANCE` reads only `acceptance.md`: pass → `COMPLETE` and reset `evaluator_reject`; fail → `ACCEPTANCE_REJECTED` and increment it.

After test/regression parse, call `recordTestVerification()` for the exact release attempt. A blocked result invalidates aggregate test status/G2 while retaining immutable attempt evidence, so the repaired candidate must enter a new `TEST_RELEASE`.

## Circuit counters and completion

Counters represent consecutive active-loop failures, not lifetime totals. Review PASS resets `review_revision`; verified bug clears its `fix_per_bug` entry; acceptance PASS resets `evaluator_reject`. Breakers are evaluated only in their matching retry states and cannot redirect release, gates, normal development, or `COMPLETE`.

At `COMPLETE`, sync README and let Git Custodian record any final docs candidate. Remote merge/finalize still requires explicit user authorization under the common controller.
