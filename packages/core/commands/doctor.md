---
description: "Validate workspace repositories, private overlay, and progress.json v2 files without changing project state."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "[workspace-root] [--release-test] [--feature <id>] [--worktrees [--sizes]]"
---

# /cc-nexs:doctor

Resolve the installed plugin root and run:

```sh
node "${CC_NEXS_PLUGIN_ROOT}/lib/doctor.mjs" "${1:-$PWD}" ${2:-}
```

Pass `--release-test` for strict automatic-delivery readiness. Strict mode blocks only unsafe or impossible test delivery: missing workspace/deploy target/release driver, a non-test environment, or plaintext credentials. A missing local driver permits direct structured command evidence: Lean uses its approved plan, Hotfix its bound scope matrix. Hotfix cannot defer checks. Report missing matrix/path/P0/P1 rollback fields and stale evidence precisely; do not prescribe a driver-only recovery for a valid direct-evidence task. Missing app/operations URLs, allowlist entries, browser capability, current login, and environment-specific test prerequisites remain verification warnings; they are checked only after a successful test merge/deployment and may pause in `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY` without undoing delivery.

Release orchestration must also pass `--feature <id>`. This scopes progress/config/worktree consistency checks to the candidate being delivered, so a stale unrelated task cannot block its safe test merge. Workspace repositories and global delivery safety are still checked in full.

Pass `--worktrees` to inventory `.worktrees/` and `.cc-nexs/runtime/test-conflicts/`; add `--sizes` to measure each entry (slow on large dependency trees). Only completed tasks whose clean branch is merged into the last fetched base, worktrees Git no longer tracks, and test-conflict copies that are not the live conflict are listed as reclaimable; active, dirty, unmerged, or unidentified worktrees are kept with a reason. The listing ends with the `/cc-nexs:git-custodian reclaim` confirmation token.

This command is read-only. It also validates `models.routing`, canonical `risk_tier`, feature config version, and approved Lean Gateway A risk integrity. Legacy Lean/Hotfix feature mappings are warnings with the exact `/cc-nexs:migrate-feature-config <id>` remediation. A hash-verifiable legacy Gateway A risk is reported with the opt-in `--bind-plan-risk` remediation; an unstructured legacy approval is reported as conservative-high until revision and re-approval. Doctor never performs either migration. Report every error before asking the user to repair configuration.
