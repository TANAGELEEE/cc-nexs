# Full run orchestration

Read this file only when resolved mode is `full`. Common identity, safety, model routing, workflow construction, persistence, and termination remain in `commands/run.md`.

## Lifecycle

Full keeps independent recon, planning, implementation, architecture Review, QA, and evaluation roles. New features use `final_only`: all sprints finish development before one `INTEGRATION_REVIEW -> TEST_RELEASE -> FINAL_QA -> FINAL_EVAL` chain. Legacy `per_sprint` retains sprint deploy gates.

## Role → command dispatch table

| role/action | command |
|---|---|
| `repo-scout / recon` | `/cc-nexs:recon` |
| `planner|pm / draft_spec, revise_spec` | `/cc-nexs:planner` |
| `tech-lead|dev / implement` | ownership v1: one `/cc-nexs:dev <id> --mode=feat --sprint=N --assignment=<IMP-id>` per current-Sprint Assignment; legacy v0: one `/cc-nexs:dev <id> --mode=feat --sprint=N` |
| `tech-lead|dev / sync_docs` | `/cc-nexs:dev <id> --mode=doc --sprint=N` |
| `tech-lead|dev / revise_integration` | `/cc-nexs:dev <id> --mode=integration` |
| `tech-lead|dev / reevaluate_implementation` | `/cc-nexs:dev <id> --mode=re-evaluate` |
| `tech-lead|dev / fix_bug` | `/cc-nexs:dev <id> --mode=fix --bug=<BUG-ID>` |
| `tech-lead|dev / revise_implementation` | `/cc-nexs:dev <id> --mode=review-fix [--sprint=N]` |
| `sa|reviewer / review_spec` | `/cc-nexs:sa spec` |
| `sa|reviewer / review_test_cases` | `/cc-nexs:sa test-cases` |
| `sa|reviewer / review_code` | `/cc-nexs:sa code` |
| `sa|reviewer / review_final_fix` | `/cc-nexs:sa code <id> --scope=final-fix` |
| `sa|reviewer / review_integration` | `/cc-nexs:sa integration <id>` |
| `qa|verifier / write_cases` | `/cc-nexs:qa cases <id> --sprint=N` |
| `qa / revise_cases` | `/cc-nexs:qa cases <id> --sprint=N --revise` |
| `qa|verifier / run` | `/cc-nexs:qa run` |
| `qa|verifier / regression` | `/cc-nexs:qa regression` |
| `qa|verifier / run_final` | `/cc-nexs:qa final <id>` |
| `qa|verifier / regression_final` | `/cc-nexs:qa final-regression <id>` |
| `evaluator / final_acceptance` | `/cc-nexs:evaluator <id> --scope=final` |

When `nextStep()` includes parallel QA case work with implementation, flatten QA plus every first-wave Tech Lead worker into the same parent dispatch; do not hide worker fanout inside one child.

## Multi-end implementation fanout

When `nextStep()` returns `fanout: implementation_repositories`:

1. Run deterministic `validate-implementation-plan`; an approved v1 G1 binding must match current spec. Legacy approved specs without a binding/table retain one Tech Lead. A present invalid table never degrades silently.
2. Filter Assignments to current Sprint, build dependency waves, and freeze one Tech Lead runtime/model/effort/fallback snapshot for the whole group before starting any child.
3. Before the first bounded implementation batch, run parent-only `implementation-delta begin <id>` with one `--assignment` for every first-batch Tech Lead plus the fixed `--allow-doc-path test-cases.md --allow-doc-path qa-scripts/**` QA allowance, and retain its opaque token. Launch QA `write_cases` and all first-wave Tech Lead workers together. Each implementation child receives only its Assignment, assigned repository worktree, AC subset, Allowed paths, and Validation. Claude/Codex spawn all before awaiting. Pi puts QA and all first-wave workers in one `subagent({ tasks, concurrency, async: true, worktree: false, context: "fresh" })` call and joins it with `subagent_wait({ id })`. Later implementation batches open a new token without any docs allowance. Never expose the token, use nested children, or create Pi worktrees.
4. Wait for the complete first parent batch, including QA, and always run `implementation-delta end <id> --token <token>` before retrying a failed member or dispatching the next batch/wave. Repeat begin/join/end for later code-only batches. The deterministic tree delta must keep every active code repository inside its Assignment, every inactive progress-assigned code repository unchanged, and docs changes inside only the explicit first-batch QA allowance. The same code repository never runs twice concurrently.
5. After all implementation workers and QA succeed, run aggregate build/test/lint once per changed repository; repositories may verify in parallel. Any failure leaves the sprint unadvanced and creates no new candidate.
6. Only after the full barrier does Git Custodian serially create or refresh exactly one candidate per changed repository. The existing single-owner `DOC_SYNC` remains later in the state chain; implementation workers never write api-doc/deploy/dev-plan.

The G1 summary includes the Assignment/repository/wave/DAG and exact contiguous `M1..MN` Sprint total. G1 freezes that total and runtime validation rejects spec/progress drift; historical unbound v0 fails safe to M1 instead of inventing later Sprints. Cross-end API contracts must be frozen before G1; a front end does not wait for backend code merely because it calls the approved API.

## Human gates and delivery

At `SPEC_PENDING_HUMAN`, sync README first, then print feature/branch/mode, spec background and approach, AC table, sprint slices, final SA conclusion, and tradeoffs. Stop for the configured approve/revise action.

With `final_only`, each sprint code PASS advances through `SPRINT_<N>_DEV_DONE`; after `ALL_SPRINTS_DEV_DONE`, perform integration Review and exactly one initial test release. Apply the common delivery safety/post-deploy verification boundary. Start CI/CD once, persist/resume `pending`, use `--retry` only for failed attempts, and preserve a deployed attempt as `manual_required` when verification capability is unavailable.

Legacy `per_sprint` PASS enters `SPRINT_<N>_DEPLOY_GATE`. Print the code-review conclusion, candidate summary, database changes, and sprint. Stop for `/cc-nexs:approve-deploy <id>`; G2 never authorizes production.

## Conclusion routing

Parse only the corresponding file's final 30 lines with preset i18n literals:

| artifact | marker | outcomes |
|---|---|---|
| `sa-review.md` / `review.md` | `结论|Conclusion` | PASS / NEEDS_REVISION |
| `sa-code-review.md` | `结论|Conclusion` | PASS / NEEDS_REVISION |
| `test-report.md` | `结论|Conclusion` | configured pass/fail; `待人工执行` is legacy pass/non-blocking |
| `acceptance.md` | `验收结果|Acceptance` | configured pass/fail |

### Sprint review loops

- `PARSE_SA_TEST_REVIEW`: PASS → `SPRINT_<N>_DOC_SYNC`; NEEDS_REVISION → `SPRINT_<N>_SA_TEST_REVIEW_NEEDS_REVISION`, dispatch QA `revise_cases`, then return through QA cases and SA Review.
- `PARSE_SA_CODE`: PASS + `final_only` → `SPRINT_<N>_DEV_DONE`; PASS + legacy `per_sprint` → `SPRINT_<N>_DEPLOY_GATE`; NEEDS_REVISION → `SPRINT_<N>_FIX`, then docs sync and code Review.
- Sprint `FIX` handles code-review findings; only post-release `FINAL_FIX` can create another test release.

### Final-only integration and acceptance

| Parse action | PASS | FAIL |
|---|---|---|
| `PARSE_INTEGRATION_REVIEW` | `TEST_RELEASE` | `INTEGRATION_REVIEW_NEEDS_REVISION`, `review_revision++` |
| `PARSE_FINAL_QA` | `FINAL_QA_PASSED` | `FINAL_QA_BLOCKED`, create/update BUG artifacts |
| `PARSE_FINAL_FIX_REVIEW` | record candidates, `TEST_RELEASE` | `FINAL_FIX_REVIEW_NEEDS_REVISION`, `review_revision++` |
| `PARSE_FINAL_EVAL` | `COMPLETE` | `FINAL_ACCEPTANCE_REJECTED`, `evaluator_reject++` |

After QA/regression parse call `recordTestVerification()` for the exact attempt and evidence. A blocked deployed round must complete:

```text
FINAL_QA_BLOCKED -> FINAL_FIX -> FINAL_FIX_REVIEW -> TEST_RELEASE
                 -> FINAL_QA (regression_final) -> FINAL_EVAL
```

Local checks may mark a BUG `FIXED`; only deployed `regression_final` may mark it `VERIFIED`. A blocked/rejected result invalidates aggregate release/G2 while retaining attempt history, requiring a new release for a repaired candidate.

## Artifact completeness gate

Before `FINAL_QA_PASSED -> FINAL_EVAL`, require non-template `deploy.md`, `api-doc.md`, and `test-report.md`:

```bash
FAILED=0
for f in deploy.md api-doc.md test-report.md; do
  FILE="${REQ_DIR}${f}"
  if [ ! -f "$FILE" ]; then
    echo "❌ $f 不存在，阻塞进入 Evaluator"
    FAILED=1
  elif grep -qE 'YYYY-MM-DD|/api/xxx/yyy|（append）|（自动填）' "$FILE"; then
    echo "❌ $f 仍为模板内容，阻塞进入 Evaluator"
    FAILED=1
  fi
done
```

On failure return to `INTEGRATION_REVIEW_NEEDS_REVISION` so Tech Lead completes docs and SA re-reviews before Evaluator.

## Circuit counters and completion

Counters are consecutive active-loop failures. Review PASS resets `review_revision`; deployed BUG verification clears its `fix_per_bug`; acceptance PASS resets `evaluator_reject`. Evaluate breakers only inside the corresponding failure loop.

At `COMPLETE`, sync README and have Git Custodian capture the last docs candidate. Remote merge/finalize remains explicitly user-authorized under the common controller.
