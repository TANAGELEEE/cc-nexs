# BUG {id} · {feature-slug}

## Bug and Impact
- Symptom:
- Affected targets/environments:
- Reproduction steps:
- Urgency:
- Root cause:
- Why the original tests did not catch it:
## Bound Scope
Fill in the actual path and verification command, then bind. For scope, tier, or command adjustments, use `revise-hotfix` to record existing user authorization; for contract/schema/permission extensions, use `--promote-lean` to upgrade to Lean alongside the original BUG and go through Gateway A again.
<!-- HOTFIX-SCOPE START -->
- severity: P2
- related_feature: -
- intended_paths: -
- affected_acs: -
- rollback_owner: -
- rollback_steps: -
- acceptance_contract_change: no
- api_contract_change: no
- database_schema_change: no
- permission_model_change: no
- broad_refactor: no
- non_behavioral_change: no

### Local Verification Matrix

| Check | Repository | Command/Driver | Expected Result |
|---|---|---|---|
<!-- HOTFIX-SCOPE END -->
`intended_paths` takes comma-separated `repo-id/path` entries; for P0/P1 you must fill in the affected ACs, the rollback owner, and the steps. Each row of the matrix must contain a unique Check ID and the actual command, covering at minimum the necessary reproduction and regression checks; do not substitute explanatory text or placeholder commands.
## Implementation and Rollback
- Fix plan:
- Affected call surface:
- Rollback verification evidence:
## Local Verification
Use the configured driver, or, when no driver is available, run the command in the binding matrix and record `check/command/exit_code/proof/result`. Evidence binds to the exact candidate; Hotfixes may not be deferred to test.
## Consolidated Review
P0/P1/P2/P3 all require independent review. File counts and changed line counts are for risk reference only; they cannot prove that no behavior changes occurred. Record conclusions for candidates, blockers, and fix deltas.
## Test Environment Acceptance
- candidate fingerprint：
- test attempt / environment revision：
- BUG repro：
- affected AC / P0/P1：
- smoke test：
- conclusion：
- environment limitations and unverified items：
## Gateway B Change Request

| ID | Type | Proposer | Allowed modification paths | Comments | Status |
|---|---|---|---|---|---|

## Release Summary
- test target: the configured `test_branch`
- base target: the configured `base_branch`
- exact candidate:
- manual approval:
- environment exception authorization and rollback evidence (if applicable):

An environment exception only authorizes integration against the configured base; the fact that test did not pass remains on record, and production deployment is not authorized by default.
