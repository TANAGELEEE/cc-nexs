---
description: "Lean: one consolidated Review and at most one delta closure check."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Task"
argument-hint: "[requirement ID] [--closure|--gateway-b-delta]"
---

# /cc-nexs:lean-review

First use `assertPlanApprovalCurrent` to verify the Gateway A hash, then resolve `lean-reviewer` from the bound `risk_tier`: `resolveRoleRuntime(..., {models: mergedModels, featureConfig, progress: progressV2, planText})`. `high|critical` automatically hits `escalated`; an explicit feature profile ultimately takes precedence. Print the risk source, matched rule, and final profile/model/effort. The Reviewer can be configured as a different model, or use the same model as the Developer with higher effort; regardless of configuration, it must be an independent session.

The complete Review input is only the approved requirements, plan scope, cumulative diff across the whole repository, list of changed files, local evidence, and the exact candidate commits for the same candidate. Output all P0/P1 at once in the `cc-nexs-review` block defined by `rules/review-findings.md`; only run-proven P0/P1 failures or candidate/evidence inconsistency block, and P2/P3 are non-blocking. After writing to `plan.md`, the parent Orchestrator reruns each blocking command against the same candidate and executes the command below:

The complete Review for `fast-track` runs after the first test acceptance and simultaneously reads the condensed black-box evidence for that attempt/environment revision; `standard` still runs before test delivery. Both must bind to the same exact candidate before Gateway B.

The Reviewer must treat the base...candidate from approval time as the sole diff, and must not misreport pre-existing branch files or out-of-path changes as findings for this round. Environment check gaps explicitly recorded as `deferred_to_test` and executable by the test matrix are not P1; only code defects, uncovered ACs, or candidate/evidence inconsistency may block. Do not demand architecture hardening beyond the AC or batches of new tests in the name of being "more complete".
```text
node <plugin-root>/lib/cc-nexs-cli.mjs record-review <id> --document-findings [--not-reproduced <finding-id>]...
```
The controller derives PASS/blocked from the block; the Reviewer's conclusion line does not override it. Send only the recorded `blocking_findings` to the Developer. In `standard`, inject each user-observable unproven P0/P1 finding into the Verifier as `probe:<finding-id>`.
`--closure` reruns only the original findings' commands and reviews the fix delta for regressions it introduced, then runs `record-review ... --document-findings --closure`. If the closure fails again, go straight to `HUMAN_INTERVENTION`; do not start a third Review round.

`--gateway-b-delta` reviews only the current Gateway B request, the corresponding code delta, the affected call sites, and new local evidence for the same candidate, then runs `record-review ... --document-findings --gateway-b-delta`. After a PASS, the test must be republished and regression run; on NEEDS_REVISION, go straight to human intervention and do not start a new automatic Review loop.
