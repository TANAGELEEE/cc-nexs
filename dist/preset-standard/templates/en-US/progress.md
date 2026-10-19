# {id} {feature-slug} Progress
> This file is a human-readable mirror of `progress.json` v2, refreshed by the orchestrator. Authoritative state, gates, counters, and events live only in progress.json; no role may modify either directly.
## Current State

```yaml
current_state: INIT
updated_at: null
```

## State Machine Dictionary
> Status comes in three sets: lean is the default for new requirements, full supports development across multiple Sprints, and fast is fixed to a single Sprint.
> Which set is used is determined by progress.json.mode, and it must be consistent with config.json.mode.
### lean mode (mode=lean, default)

| Status | Meaning |
|---|---|
| INIT / PLANNING | Lean Planner maintains requirements.md and plan.md |
| **PLAN_PENDING_HUMAN** | ⏸️ Gateway A，approve requirements + plan scope hash |
| PLAN_APPROVED / IMPLEMENTING | Implement in each repo's feature worktree according to path ownership |
| LOCAL_VERIFYING | Deterministic driver executes build/start/smoke/e2e |
| CONSOLIDATED_REVIEW | Independent Reviewer reviews all cumulative diff in a single pass and blocks only P0/P1 |
| REVIEW_FIXING / LOCAL_REVERIFYING / REVIEW_CLOSURE | Blocking-item fixes, local re-verification, at most one delta closure |
| CANDIDATE_READY / TEST_RELEASE | Exact candidate merged into test and released |
| TEST_VERIFYING / TEST_FIXING | test black-box acceptance; complete fix loop after failure |
| TEST_VERIFIED | All necessary ACs pass in the test environment |
| **RELEASE_PENDING_HUMAN** | ⏸️ Gateway B, approve reviewed + test-verified fingerprint |
| GATEWAY_B_CHANGE_REQUESTED / FIXING / LOCAL_REVERIFYING / DELTA_REVIEW | Single-pass incremental fix loop for feedback within the Gateway B scope |
| SCOPE_CHANGE_REQUESTED | Gateway B changes the requirements/AC/solution boundary, returns to Planner and Gateway A |
| BASE_MERGING | Git Custodian non-force merges into the config base, docs last |
| COMPLETE | base integration and cleanup complete |
| HUMAN_INTERVENTION / *_BLOCKED | delta Review, release, or branch protection require human handling |

### full mode (mode=full)

| Status | Meaning |
|---|---|
| INIT | 需求目录已建，requirements.md 待填 |
| REQ_DRAFTED | requirements.md has been written, awaiting the Planner to expand the spec |
| SPEC_DRAFTED | spec.md written, pending SA Review |
| SPEC_REVIEWING | SA is reviewing the spec |
| SPEC_NEEDS_REVISION | SA Review failed; return to Planner for revision |
| **SPEC_PENDING_HUMAN** | ⏸️ Human gate G1, awaiting the approve-spec entry point of the current runtime |
| SPEC_APPROVED | Manually released, enter the Sprint loop |
| SPRINT_<N>_KICKOFF | Sprint N Kickoff |
| SPRINT_<N>_QA_CASES | QA is writing Sprint N test cases |
| SPRINT_<N>_DEV | Tech Lead is writing Sprint N code |
| SPRINT_<N>_SA_TEST_REVIEW | SA is reviewing Sprint N test cases |
| SPRINT_<N>_SA_TEST_REVIEW_NEEDS_REVISION | SA rejects the test cases; pending QA revision, then re-Review |
| SPRINT_<N>_DOC_SYNC | Tech Lead syncs deploy.md / api-doc.md |
| SPRINT_<N>_DOC_SYNC_DONE | Sprint documentation sync complete, awaiting code review |
| SPRINT_<N>_SA_CODE | SA reviews the Sprint N code |
| SPRINT_<N>_FIX / FIX_DONE | Fix Sprint Review items and re-review |
| SPRINT_<N>_DEV_DONE | Sprint N development loop complete; no deployment, no acceptance |
| ALL_SPRINTS_DEV_DONE | All Sprint development completed |
| INTEGRATION_REVIEW | Complete candidate cross-Sprint/cross-repo Review |
| INTEGRATION_FIX | Integration revision complete, pending re-Review |
| TEST_RELEASE | Full feature merged into test + released; defaults to auto_if_ready |
| TEST_RELEASE_BLOCKED | test merge/driver/release failed, stop processing |
| TEST_DEPLOYED_NEEDS_MANUAL_VERIFY | Deployed, but automated environment verification could not be completed |
| FINAL_QA | QA executes cumulative test cases in the deployed test environment |
| FINAL_QA_BLOCKED | Issues found during post-deployment testing |
| FINAL_FIX / FINAL_FIX_REVIEW | Fix, independent re-review, then TEST_RELEASE must be re-run |
| SPRINT_<N>_TECH_LEAD_REVIEW | 🛑 Circuit breaker: same BUG fixed 3 times, escalated |
| FINAL_EVAL | Evaluator final full scoring |
| COMPLETE | All checks passed; the feature branch can be merged |
`SPRINT_<N>_DEPLOY_GATE / QA_RUN / QA_REGRESSION / EVAL / DONE / ALL_SPRINTS_DONE` applies only to legacy `per_sprint` requirements that have no `delivery` field.
### fast mode (mode=fast, three roles merged in one sprint)

| Status | Meaning |
|---|---|
| INIT | 需求目录已建，requirements.md 待填 |
| REQ_DRAFTED | requirements.md written, pending Fullstack to expand the spec |
| SPEC_DRAFTED | spec.md written, pending Reviewer review |
| SPEC_REVIEWING | Reviewer is reviewing the spec |
| SPEC_NEEDS_REVISION | Reviewer Review did not pass, return to Fullstack for revision |
| **SPEC_PENDING_HUMAN** | ⏸️ Human gate G1, awaiting the approve-spec entry point of the current runtime |
| SPEC_APPROVED | Manually released to proceed to the implementation phase |
| BUILD | Fullstack writing code + syncing dev-plan/api-doc/deploy |
| CODE_REVIEW | Reviewer Review code（only sa-code-review.md） |
| CODE_REVIEW_NEEDS_REVISION | Code review failed; return to Fullstack to fix |
| TEST_RELEASE | Full candidates are automatically released to test by default; fall back to manual G2 here if capability is insufficient |
| TEST | Verifier produces test-cases.md + test-report.md in one pass （initial） |
| TEST_BLOCKED | Verifier reports blocked, entering repair |
| FIX | Fullstack is fixing the specified BUG |
| FIX_REVIEW | Reviewer Review fixes candidate；after PASS, re-run TEST_RELEASE |
| REGRESSION | Verifier regression after the new test is deployed (rerun BUG repro + sprint P0/P1) |
| TEST_PASSED | Verifier passed; proceeding to contract acceptance |
| ACCEPTANCE | Reviewer produces acceptance.md （test-report.md is ready at this point） |
| ACCEPTANCE_REJECTED | Contract acceptance failed, return to BUILD |
| HUMAN_INTERVENTION | 🛑 Circuit breaker: same BUG fixed ≥2 times, stop and require human intervention |
| COMPLETE | All checks passed; the feature branch can be merged |

## Counters

```yaml
review_revision: 0              # 当前 review 循环连续 NEEDS_REVISION 次数；PASS 后清零
fix_per_bug: {}                 # 同一 BUG 连续部署回归失败次数；VERIFIED 后清除
evaluator_reject: 0             # 当前 acceptance 循环连续拒绝次数；PASS 后清零
```

## Circuit-Breaker Thresholds

```yaml
review_revision: 3              # 当前 review 循环连续 ≥3 次升级回 SPEC_REVIEWING
fix_per_bug: 3                  # 同 BUG 连续 ≥3 次升级到 TECH_LEAD_REVIEW
evaluator_reject: 2             # 当前 acceptance 循环连续 ≥2 次升级回 spec
```

## Sprint Progress

```yaml
total_sprints: 0                # Planner 展开 spec 时填
current_sprint: 0
sprint_status:
  # M1: not_started | in_progress | done
```

## Human Gate

### G1: Spec Approval

```yaml
human_approved_at: null
human_approver: null
spec_summary_for_human: null    # orchestrator 在 SPEC_PENDING_HUMAN 时填
```

### G2: Manual Test Release Confirmation (explicit opt-out or missing prerequisites only)

```yaml
g2_approved: false              # final_only/fast 的完整需求手工发布确认
# legacy full per-sprint markers:
# g2_sprint_1_approved: true
# g2_sprint_2_approved: true
g2_approved_at: null
g2_approver: null
```

## History

<!-- Each state transition is appended as one line by the orchestrator -->
<!-- Format: - <ISO8601> <prev_state> → <next_state>  Reason -->
- (None yet)

## Human Required

<!-- Items that are physically impossible are appended here; they do not block the flow -->
<!-- e.g.: production deployment / on-device UI verification / business definition confirmation -->
- (None yet)
