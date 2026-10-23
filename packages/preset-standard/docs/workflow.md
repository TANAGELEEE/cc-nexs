# Workflow Sequencing and Contracts

This document defines the delivery semantics of `preset-standard`. `progress.json` v2 is the authoritative state; `progress.md` is only a human-readable mirror.

## Execution and Context

Routine repository maintenance, complete existing requirements, and small-scope documentation changes do not require brainstorming. An explicit brainstorm only completes requirements.md and does not add section-by-section approval; formal Lean plan approval is still handled by Gateway A.

Execute continuously within the approved scope, reusing existing authorization. Resolve routine implementation choices yourself; scope changes go through the current mode's gate. When resuming a session, read the authoritative state and the current candidate, reuse evidence that is still valid, and avoid re-dispatching roles that have already completed.

Load only the current command, the current mode's rule, and the material needed for the current role each time. Parallel tasks should have independent goals, clear path ownership, and real benefit; they are constrained by state-machine barriers, shared repository writes, and runtime concurrency limits. The independent sessions for review and black-box acceptance remain unchanged.

Checks cover the approved ACs and affected behavior. Once existing checks pass, expand verification only for new changes, failures, or explicitly identified new risks; after the candidate changes, still update evidence as the mode requires. Output follows `rules/output-discipline.md`, retaining the conclusions the parser needs and all valid findings.

## Default Policy

New requirements use `mode=lean`. The complete chain is:
```text
init -> plan -> independent plan review (one revision at most) -> PLAN_PENDING_HUMAN (Gateway A)
-> implement -> local executable checks (pass or structured deferred_to_test)
-> fast-track: test release/CI -> test verification -> one consolidated Review
-> standard: one consolidated Review -> test release/CI -> test verification
-> RELEASE_PENDING_HUMAN (Gateway B) -> configured base merge -> COMPLETE
```
Lean 只维护两份由人工维护的文档：`requirements.md` 和 `plan.md`。Gateway A 之前由独立 Plan Reviewer 对照需求与代码审核计划，只阻塞 P0/P1；阻塞时 Planner 修订一次并复审，仍未关闭的问题带到 Gateway A 由人决定。Gateway A 要求计划审核绑定到正在批准的精确计划，并要求 `requirements.md` 的每条 AC 都对应任务、本地检查和 test 检查。每个仓库仍然需要独立 worktree、`feature/<id>-<slug>` 分支以及不可变的 candidate ref。Gateway A 绑定 requirements + plan approval scope 的哈希，其中包括 `risk_tier`、`delivery_lane` 和每个仓库的 `test_delivery.<repo>: deploy|local`；Gateway B 绑定本地验证、Review 和 test 验收所共享的精确 fingerprint。`fast-track` 只允许 low/medium；旧计划缺少 lane 时，安全地解释为 standard。

集中 Review 使用独立 session，可以选择不同模型，也可以使用相同模型但提高 effort/thinking。Lean 计划只派一个 Planner；对于 high/critical，升级 Plan Reviewer 与后续 Reviewer，不会冷启动第二个 Planner；一个计划无法整体审核与验收时，建议拆成多个 Lean 需求。P0/P1 hotfix 会自动路由到 Reviewer。显式的 feature profile 最终优先。只有 P0/P1 被视为阻塞；修复后最多进行一次 delta closure，如果再失败就转人工。

如果 Gateway B 提出意见，必须按结构分类：补充证据留在门禁；批准范围内的实现修改要经过同一个 feature worktree、本地重验、一次 Gateway B delta Review、新的 test attempt 和回归；需求、AC 或方案边界发生变化时，会使 Gateway A 哈希失效，并返回 Planner。旧 candidate 与 test attempt 仅作为历史保留，不能再授权 base merge。

新需求初始化如下：
```yaml
workflow:
  test_release:
    policy: auto_if_ready
    on_prerequisite_failure: manual_gate
```
Meaning:

- Implementation batches do not trigger additional human approval; the complete candidate undergoes test release and acceptance as one exact fingerprint.
- `--no-auto-test-release` or feature `release.test=manual` explicitly opts out of automatic test release; this fully hands subsequent releases to an external process and cannot fake an immutable release attempt or restore Gateway B. To return to cc-nexs acceptance, you must configure a driver and restore `auto_if_ready`.
- Stop before push only when the test environment, deploy target, candidate, or release driver is insufficient; the browser, login session, and acceptance URL only affect verification after deployment.
- The base branch merge is explicitly authorized by Gateway B; production release always remains a separate human action.

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
- Hotfix Gateway B: approves merging the exact test-verified candidate into base.
- `TEST_RELEASE_BLOCKED`: test merge/push/driver failure.
- `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY`: the driver is deployed but automated environment verification cannot be completed.
- Circuit breaker: review/fix reaches the threshold.

The circuit-breaker count is the number of consecutive failures in the current loop: it resets to zero after the corresponding review PASS, and a BUG's fix count is cleared after post-deployment verification returns VERIFIED. The state machine checks the circuit breaker only in the corresponding failure/retry state; a high historical count will not hijack TEST_RELEASE, other stages, or COMPLETE.

A Gate only pauses cc-nexs role dispatch; it does not install a global tool lock.

## Definition of Done

Lean and Hotfix enter base merge only after explicit authorization from Gateway B, and `COMPLETE` requires the proven base integration. They still do not automatically authorize:

- merging main/master;
- production release;
- deleting the remote feature;
- cleaning up worktrees.

These operations continue to be performed by the Git Custodian/release system under explicit user authorization.
