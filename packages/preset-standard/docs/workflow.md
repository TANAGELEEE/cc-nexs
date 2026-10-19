# Full-Workflow Sequencing and Contracts

This document defines the delivery semantics of `preset-standard`. `progress.json` v2 is the authoritative state; `progress.md` is only a human-readable mirror.

## Execution and Context

Routine repository maintenance, complete existing requirements, and small-scope documentation changes do not require brainstorming. An explicit brainstorm only completes requirements.md and does not add section-by-section approval; formal Lean plan approval is still handled by Gateway A.

Execute continuously within the approved scope, reusing existing authorization. Resolve routine implementation choices yourself; scope changes go through the current mode's gate. When resuming a session, read the authoritative state and the current candidate, reuse evidence that is still valid, and avoid re-dispatching roles that have already completed.

Load only the current command, the current mode's rule, and the material needed for the current role each time. Parallel tasks should have independent goals, clear path ownership, and real benefit; they are constrained by state-machine barriers, shared repository writes, and runtime concurrency limits. The independent sessions for review and black-box acceptance remain unchanged.

Checks cover the approved ACs and affected behavior. Once existing checks pass, expand verification only for new changes, failures, or explicitly identified new risks; after the candidate changes, still update evidence as the mode requires. Output follows `rules/output-discipline.md`, retaining the conclusions the parser needs and all valid findings.

## Default Policy

New requirements default to `mode=lean`. The full chain is:
```text
init -> plan -> PLAN_PENDING_HUMAN (Gateway A)
-> implement -> local executable checks (pass or structured deferred_to_test)
-> fast-track: test release/CI -> test verification -> one consolidated Review
-> standard: one consolidated Review -> test release/CI -> test verification
-> RELEASE_PENDING_HUMAN (Gateway B) -> configured base merge -> COMPLETE
```
Lean 只维护两份由人工维护的文档：`requirements.md` 和 `plan.md`。每个仓库仍然需要独立 worktree、`feature/<id>-<slug>` 分支以及不可变的 candidate ref。Gateway A 绑定 requirements + plan approval scope 的哈希，其中包括 `risk_tier`、`delivery_lane` 和每个仓库的 `test_delivery.<repo>: deploy|local`；Gateway B 绑定本地验证、Review 和 test 验收所共享的精确 fingerprint。`fast-track` 只允许 low/medium；旧计划缺少 lane 时，安全地解释为 standard。

集中 Review 使用独立 session，可以选择不同模型，也可以使用相同模型但提高 effort/thinking。Lean 计划只派一个 Planner；对于 high/critical，只升级后续 Reviewer 并建议 Full，不会冷启动第二个 Planner。P0/P1 hotfix 会自动路由到 Reviewer。显式的 feature profile 最终优先。只有 P0/P1 被视为阻塞；修复后最多进行一次 delta closure，如果再失败就转人工。

如果 Gateway B 提出意见，必须按结构分类：补充证据留在门禁；批准范围内的实现修改要经过同一个 feature worktree、本地重验、一次 Gateway B delta Review、新的 test attempt 和回归；需求、AC 或方案边界发生变化时，会使 Gateway A 哈希失效，并返回 Planner。旧 candidate 与 test attempt 仅作为历史保留，不能再授权 base merge。

新需求初始化如下：
```yaml
workflow:
  sprint_delivery: final_only
  test_release:
    policy: auto_if_ready
    on_prerequisite_failure: manual_gate
```
Meaning:

- A Sprint is responsible only for development, project-local verification, test cases, and code review.
- Sprint completion does not merge into test, does not release, and does not perform acceptance scoring; the number of Sprints and implementation batches do not trigger additional human approval.
- After all Sprint development is complete, the complete candidate undergoes integration review, test release, and final acceptance only once.
- `--no-auto-test-release` or feature `release.test=manual` explicitly opts out of automatic test release; in Lean/Hotfix this fully hands subsequent releases to an external process, G2 itself will not fake an immutable release attempt, nor can it directly restore Gateway B. To return to cc-nexs acceptance, you must configure a driver and restore `auto_if_ready`.
- Stop before push only when the test environment, deploy target, candidate, or release driver is insufficient; the browser, login session, and acceptance URL only affect verification after deployment.
- Lean's main branch merge is explicitly authorized by Gateway B; fast/full production/main branch merges retain the old human authorization semantics.

Legacy progress without a `delivery` field is always interpreted as `per_sprint + manual`. Upgrading the plugin must not automatically add remote write permission to historical requirements.

## Full State Main Chain
```text
INIT -> REQ_DRAFTED -> RECON_DONE -> SPEC_DRAFTED -> SPEC_REVIEWING
     -> SPEC_PENDING_HUMAN (G1) -> SPEC_APPROVED

     -> SPRINT_1_KICKOFF -> DEV + QA_CASES -> SA_TEST_REVIEW
     -> DOC_SYNC -> SA_CODE -> SPRINT_1_DEV_DONE
     -> ...
     -> SPRINT_N_DEV_DONE -> ALL_SPRINTS_DEV_DONE

     -> INTEGRATION_REVIEW -> TEST_RELEASE
     -> FINAL_QA -> FINAL_EVAL -> COMPLETE
```
### Sprint Contract

| Phase | Executing Role | Required Artifacts | After PASS |
|---|---|---|---|
| KICKOFF | Multi-repo Tech Lead + QA in parallel | ownership wave implementation, per-repo build/test, Sprint test cases | SA test case review |
| SA_TEST_REVIEW | SA | new round of `sa-test-review.md` | Tech Lead docs sync |
| DOC_SYNC | Tech Lead | `api-doc.md`, `deploy.md` Sprint sections | SA code review |
| SA_CODE | SA | new round of `sa-code-review.md` | `SPRINT_<N>_DEV_DONE` |
| DEV_DONE | Orchestrator | candidate ref and exact path | next Sprint or integration review |

A `NEEDS_REVISION` in SA_CODE must go through:
```text
SPRINT_<N>_FIX -> Tech Lead revise_implementation
-> SPRINT_<N>_FIX_DONE -> fresh SA code review
```
Old SA conclusions cannot be reused after a fix.

A test case review `NEEDS_REVISION` must go through:
```text
SPRINT_<N>_SA_TEST_REVIEW_NEEDS_REVISION
-> QA revise_cases -> SPRINT_<N>_QA_CASES
-> fresh SPRINT_<N>_SA_TEST_REVIEW
```
`DOC_SYNC` explicitly dispatches the Tech Lead `sync_docs` in both `final_only` and legacy `per_sprint`, and only enters code review after it completes.

## Full Requirements Integration Review

After `ALL_SPRINTS_DEV_DONE`, the SA conducts a single review of:

- all ACs and the cumulative implementation across Sprints;
- the base...candidate diff of every code repository;
- frontend/backend and cross-repo API contracts;
- DB, configuration, release order, and rollback;
- cross-Sprint composite paths and cumulative test coverage.

`NEEDS_REVISION` path:
```text
INTEGRATION_REVIEW_NEEDS_REVISION
-> Tech Lead revise_integration
-> INTEGRATION_FIX
-> fresh INTEGRATION_REVIEW
```
When AC changes are needed, it must go back to Planner and G1; the Tech Lead must not modify the contract on its own.

## Test release

After entering `TEST_RELEASE`, the automated path checks only the following before remote mutation:

1. Every `deploy` code repository has a `test_branch`, and all deploy/local candidate refs resolve to immutable SHAs.
2. The project configuration has a structured `release.test.driver`.
3. The environment is explicitly test, and the configured URL does not point to production.
4. There are no plaintext passwords/tokens in configuration, Markdown, memory, or Git; only opaque `credential_ref` is allowed.

A missing `test_branch` is not automatically inferred as local; a repository is skipped from push only when Gateway A has already bound `test_delivery.<repo>: local`. Local candidates still enter the full fingerprint and must maintain an exact clean worktree.

Runtime browser capabilities:

| Runtime | Provider |
|---|---|
| Claude Code | `chrome-devtools-mcp` |
| Codex | Current in-app/Chrome login session |
| Pi | ego lite preferred (isolated task Space); when unavailable, `@injaneity/pi-computer-use@0.4.3` (`headless: true`) |

Observable behavior of the browser, login/MFA, `app_url` / `operations_url`, allowlist, and S3 bucket/CORS/IAM is checked after deployment. Missing capabilities do not block the test merge; after a successful deployment, `manual_required` is recorded and the state moves to a recoverable `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY`.

The automation controller follows `release_order`:

1. fetch the latest `origin/<test_branch>`;
2. merge the candidate with `--no-ff` in a temporary detached worktree;
3. perform a normal non-force push;
4. fetch again and prove that the remote contains the source/integration SHA;
5. call release driver start; if CI/CD has not yet completed, return `pending + pipeline` and persist `deploying`;
6. subsequent `release-test --resume` only polls the same attempt and does not repeat merge/push/pipeline triggering;
7. record integration, pipeline, deployment, and environment_revision in `delivery.test.attempts[]`.

If any repository fails, retain the evidence already collected and stop. After entering release-blocked, only an explicit `--retry` recovers and creates a new attempt from the latest remote tip; repositories that already contain the candidate are skipped idempotently. While `deploying`, the candidate is frozen: only `--resume` of the same pipeline is allowed, and neither retry nor candidate switching is permitted.

## Final QA and acceptance

After the first test release succeeds, QA `final` executes all Sprint-accumulated P0/P1 items, cross-Sprint integration paths, and necessary UI/ops-console checks.

Pass conditions:

- The report is bound to the current release attempt and environment_revision;
- All required P0/P1 items are executed and pass;
- No OPEN/FIXED BUG;
- `test-report.md` ends with `结论: 通过`.

Required test cases must not be passed off as passing with “pending manual hookup.” Production-only/optional items may be listed as residual risks.

After QA PASS, the Evaluator performs a single full AC scoring pass with `scope=final`. The new process does not require per-Sprint acceptance sections.

## Deployment acceptance failure loop
```text
FINAL_QA_BLOCKED
-> FINAL_FIX                 Tech Lead，本地验证只到 FIXED
-> FINAL_FIX_REVIEW          独立 SA/Reviewer 新轮次
-> TEST_RELEASE              新 candidate 重新发布
-> FINAL_QA                  final-regression，新 environment_revision
-> FINAL_EVAL
```
Only the post-deployment `final-regression` can move a BUG from `FIXED` to `VERIFIED`. A fix review returning `NEEDS_REVISION` enters `FINAL_FIX_REVIEW_NEEDS_REVISION`; reimplement first, then review again.

If final acceptance fails, the work enters integration revision, re-review, re-release, and regression; the status cannot be changed directly to COMPLETE.

## Fast Mode

Fast is fixed to a single Sprint, but delivery semantics are the same:

The Fast/Full spec fixes `IMPLEMENTATION-OWNERSHIP` before G1. Different assigned repository/worktree in the same Wave truly run in parallel; the same repository is always serial. Freeze model routing for the whole batch first, then after all workers join, run per-repo aggregate verification with one candidate per repo. In Fast, the shared dev-plan/api-doc/deploy is synced by the single Fullstack after the join; Full retains a separate DOC_SYNC. Claude Task and Codex native agents must both launch the complete wave before waiting; Pi uses one `subagent({ tasks, concurrency, async: true, worktree: false, context: "fresh" })` and one `subagent_wait` to implement the same barrier.
```text
SPEC_APPROVED -> BUILD -> CODE_REVIEW -> TEST_RELEASE
-> TEST -> TEST_PASSED -> ACCEPTANCE -> COMPLETE
```
Failure loop:
```text
TEST_BLOCKED -> FIX -> FIX_REVIEW -> TEST_RELEASE -> REGRESSION
```
Every FIX round must produce a new candidate and a new Reviewer conclusion. When release attempt > 1, regression must be used; it must not be passed off as initial again.

## Hotfix

Hotfix uses `init-hotfix` to create `hotfix/<key>` and `.worktrees/<key>/<repo>/` from the latest base of each repository, without consuming a shared requirement number or pushing placeholder files. When there is an associated requirement, the BUG document is written to `doc/<id>.<slug>/bugs/BUG-<key>.md`; otherwise, it is written to `hotfix/<key>/BUG-001.md` in the docs repository. Machine state is located in the workspace at `.cc-nexs/hotfixes/<key>/`, with the document linked via `progress.hotfix_document`. Legacy hotfix.md tasks retain a compatibility path.
```text
scope bind -> implement -> local verify -> independent Review (all severities)
-> exact candidate -> test -> independent black-box verify
-> HOTFIX_RELEASE_PENDING_HUMAN -> exact candidate -> base
```
The binding scope must include the actual intended_paths and the local command matrix; P0/P1 must additionally include the affected ACs, the rollback owner, and the rollback steps. When no driver is available, real structured evidence from the bound commands may be registered; Hotfixes may not be deferred. P3 must also be Reviewed; file count/line count serve only as a risk reference. Keep the existing single delta and failure circuit breaker; do not add fixed rounds.

For an authorized path/tier revision of the same failure, use `revise-hotfix` to rebind on the original key/branch, preserving history and invalidating the current evidence. For genuine contract/schema/permission extensions, use `--promote-lean` to create `<BUGstem>.lean/` next to the BUG, migrate the state, and return to Gateway A without taking a new number. Gateway B evidence comments only supplement documentation; implementation comments require re-verification; merging base from test is forbidden.

After an actual test deployment, if environment capabilities result in `manual_required`, `approve-release --test-exception` may be used on the existing Gateway B under explicit user authorization. The same candidate must already have passing local evidence and an independent Review, and the authorization, environment limitations, and rollback evidence must be recorded; product failures cannot be exempted. Preserve the fact that test did not pass; the exception only authorizes configuring base integration and does not authorize production deployment by default. The final docs candidate submits only this BUG's documentation; machine state remains in the workspace.

## Gates and Stop Conditions

- Lean Gateway A: approves requirements and plan scope.
- Lean Gateway B: approves the exact fingerprint that has been locally verified, centrally Reviewed, and accepted by test.
- Lean Gateway B change request: `evidence` does not change the candidate; `implementation` goes through a bounded delta; `scope` returns to Gateway A.
- G1: the only fixed human product decision point after the spec review PASS.
- G2: used only for an explicit manual policy or a genuine test delivery block; a missing browser/login/URL no longer falls back to G2. legacy per_sprint retains its old meaning.
- `TEST_RELEASE_BLOCKED`: test merge/push/driver failure.
- `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY`: the driver is deployed but automated environment verification cannot be completed.
- Circuit breaker: review/fix/evaluator reaches the threshold.

The circuit-breaker count is the number of consecutive failures in the current loop: it resets to zero after the corresponding review/acceptance PASS, and a BUG's fix count is cleared after post-deployment verification returns VERIFIED. The state machine checks the circuit breaker only in the corresponding failure/retry state; a high historical count will not hijack TEST_RELEASE, other stages, or COMPLETE.

A Gate only pauses cc-nexs role dispatch; it does not install a global tool lock.

## Definition of Done

Fast/full `COMPLETE` means complete test delivery, post-deployment QA, and final contract acceptance have passed. Lean enters base merge only after explicit authorization from Gateway B; it still does not automatically authorize production deployment.

Legacy mode does not automatically authorize:

- merging main/master;
- production release;
- deleting the remote feature;
- cleaning up worktrees.

These operations continue to be performed by the Git Custodian/release system under explicit user authorization.

Pi API compatibility: `cc_nexs_dispatch` adapts the wave above to legacy tasks or Tintin RPC v2 with assigned cwd. Tintin uses completion notifications and `get_subagent_result` instead of `subagent_wait`; the all-sibling barrier and role ownership remain unchanged.
