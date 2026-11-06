# Plan — {id}.{feature-slug}
> This file is the sole plan, Review, and verification summary for Lean mode. Detailed run logs are kept in a local temporary directory and are not pasted into this file.
<!-- APPROVAL-SCOPE START -->

## Current State and Boundaries
- Reusable implementation:
- Affected repositories/modules:
- Non-goals:
- Affected features (.cc-nexs/verify/features/ entries, each with a TV regression smoke; "none" without a feature map):
## Technical Plan
- Core design:
- Frontend/backend/API contract:
- Database and configuration:
- Compatibility and rollback:
## Tasks and Parallel Waves

| Task | AC | Repository | Allowed paths | Dependencies | Verification | Wave |
|---|---|---|---|---|---|---|
| T-001 | AC-001 |  |  | None |  | W1 |

## Delivery Strategy
- delivery_lane: pending
- Fast-track eligibility: reuse existing capabilities / no new table schemas or migrations / no new infrastructure or secrets / no public breaking contracts / risk is low or medium
- Unmet items and reasons:
## Test Delivery Topology
Each code repository must keep one machine-parseable policy line; `deploy` must configure `test_branch`, and `local` is used only to launch locally from the exact candidate worktree and connect to the deployed test service.

- test_delivery.<repo-id>: deploy / local
| Repository | Candidate destination | Verification method |
|---|---|---|
|  | test_branch / local | Deploy to test / Start locally and connect to the test backend |

## Local Verification Matrix

| Check | AC | Type | Command/Driver | Pass criteria | Test action when local execution is not possible |
|---|---|---|---|---|---|
| LV-001 | AC-001 | lint/typecheck/targeted test/browser |  |  |  |

Local verification is a fast check before deployment; acceptance in test is the main gate. Frontend changes run lint, type check, and targeted tests, with a `browser: <start command> @ <page path>` row for each affected page; backend changes run targeted tests. CI runs the full production build, so add it here only when the change touches build configuration, dependencies, lockfiles, route generation, or publishing. When the test environment relaxes a production check (strict build, publication or translation validation), add the production-strict command for the affected area here: Test cannot prove it.

## Test Environment Acceptance Matrix

| Check | AC | Environment Action | Pass Criteria |
|---|---|---|---|
| TV-001 | AC-001 |  |  |

## Baseline and Terminal Sampling
- Baseline fast check (fast checks and dependency-install dry run on base; existing failures and the decision they need):
- Terminal consumer (indexer, crawler, pipeline, batch job; write "none" if there is none):
- Admission conditions and real sample result (from current sources and real output, without publishing):
## Pre-authorized Test Operations
- Test environment operations (action, target, rollback; not asked again after Gateway A):
- Verification accounts and data (accounts by role, plan, credits and other properties; how to prepare each: test-database SQL, an operations admin action, a sync from another test environment; Verifiers run these after Gateway A without asking again; the account the browser is already signed in with is used by default, with no extra restrictions):
- Test integration policy (derived paths, and per path either the command that regenerates them or "keep the Test side" when Test does not consume the candidate's values; write "none" if there is none):
- derived_binding: each-candidate / before-final-test (keep one; before-final-test leaves derived paths at their base values until the source passes Test, then generates them once for a final Test attempt)
## Risks and Release
- risk_tier: pending
- Risk assessment basis:
- Focus areas for centralized review:
- Release order:
- Rollback plan:
## Complexity and Size
- Complexity: low / medium / high
- High-risk items: none / high coupling across multiple modules / breaking public contract / high permission or funding risk / destructive migration / other
- Size recommendation: keep one Lean requirement / split into several Lean requirements
- Basis for judgment:
<!-- APPROVAL-SCOPE END -->

## Plan Review

- Review mode: skipped (low/medium, reviewed by the human at Gateway A) / independent fact check (high/critical)
- Plan source: Planner draft / user plan mode (--from)
- Review round:
- P0/P1 blocking items:
- Non-blocking notes:
- 计划审核结论: pending

## Execution Status

| Task | Status | Modified Path | Candidate | Notes |
|---|---|---|---|---|

## Local Verification Log

| Attempt | Candidate fingerprint | Result | Evidence summary |
|---|---|---|---|

## Consolidated Review
- Reviewed fingerprint:
- Reviewers (panel members and models):
- Blockers (run-proven P0/P1 confirmed by the Judge rerun):
- Unproven (sent to test verification as probes):
- P2/P3, refuted, and rejected:
- Conclusion: To be executed

<!-- The Judge ends this section with the single `cc-nexs-review` block defined in rules/review-findings.md -->
## Review Closure
- Rerun finding ids:
- Delta fingerprint:
- Conclusion: Pending execution

<!-- A closure also ends with a `cc-nexs-review` block whose round is closure -->
## Test Environment Acceptance

| Attempt | Environment revision | AC Coverage | Result | Evidence Summary |
|---|---|---|---|---|

## Final AC Coverage

| AC-ID | 本地证据 | Test 证据 | 结果 |
|---|---|---|---|

## Post-release

Steps after the base merge that this release does not perform (production deploy, data or index rebuild, notifications). Write one `- [ ] step` line per step, or "none"; tick each when done. `cc-nexs status` lists the open ones.

## Plan Changes

| Date | Change | Affects approved scope | Action |
|---|---|---|---|

## Gateway B Change Request

| ID | Type | Proposer | Affected AC | Allowed Paths | Comment | Status |
|---|---|---|---|---|---|---|
