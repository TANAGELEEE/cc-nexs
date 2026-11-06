---
description: "Lean: one consolidated Review by the review panel and a Judge, and at most one delta closure check."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Task"
argument-hint: "[requirement ID] [--closure|--gateway-b-delta]"
---

# /cc-nexs:lean-review

First use `assertPlanApprovalCurrent` to verify the Gateway A hash, then resolve `lean-reviewer` from the bound `risk_tier`: `resolveRoleRuntime(..., {models: mergedModels, featureConfig, progress: progressV2, planText})`. `high|critical` automatically hits `escalated`; an explicit feature profile ultimately takes precedence. Print the risk source, matched rule, and final profile/model/effort. This routing applies to native panel reviewers without their own `profile`/`model`, and to the Judge. Every reviewer and the Judge run in their own independent sessions.

The complete Review input is only the approved requirements, plan scope, cumulative diff across the whole repository, list of changed files, local evidence, and the exact candidate commits for the same candidate. Follow `rules/review-findings.md`: run `review-panel <id> --runtime <runtime>`, write one brief, and start every panel reviewer in parallel on that same brief (native ones as subagents, recorded with `record-reviewer`; CLI ones with `run-reviewer`). Then dispatch one Judge with every stored reviewer result. The Judge reruns each P0/P1 command, writes the single `cc-nexs-review` block into `plan.md`, and only confirmed run-proven P0/P1 failures or candidate/evidence inconsistency block; P2/P3 are non-blocking. Then execute the command below:

The complete Review runs only when the review policy requires it (`cc-nexs status` shows `review.required` and why), before test delivery, so the Verifiers test the reviewed candidate. It binds to the same exact candidate before Gateway B.

The Reviewer must treat the base...candidate from approval time as the sole diff, and must not misreport pre-existing branch files or out-of-path changes as findings for this round. Environment check gaps explicitly recorded as `deferred_to_test` and executable by the test matrix are not P1; only code defects, uncovered ACs, or candidate/evidence inconsistency may block. Do not demand architecture hardening beyond the AC or batches of new tests in the name of being "more complete".
```text
node <plugin-root>/lib/cc-nexs-cli.mjs record-review <id> --document-findings
```
The controller checks the candidate, that every panel reviewer stored its result on the model the block lists, and derives PASS/blocked from the block; the conclusion line does not override it. Send only the recorded `blocking_findings` to the Developer. Inject each user-observable unproven P0/P1 finding into the next test attempt's Verifier as `probe:<finding-id>`.
`--closure` runs `review-panel <id> --round closure` and dispatches its one reviewer, which reruns only the original findings' commands and reviews the fix delta for regressions it introduced, and the Judge, then runs `record-review ... --document-findings --closure`. If the closure fails again, go straight to `HUMAN_INTERVENTION`; do not start a third Review round.

`--gateway-b-delta` reviews only the current Gateway B request, the corresponding code delta, the affected call sites, and new local evidence for the same candidate, then runs `record-review ... --document-findings --gateway-b-delta`. After a PASS, the test must be republished and regression run; on NEEDS_REVISION, go straight to human intervention and do not start a new automatic Review loop.
