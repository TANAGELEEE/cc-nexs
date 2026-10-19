---
description: "Hotfix — independent fix branch and BUG document, local verification, independent Review, test acceptance, and Gateway B."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep, Task, Skill"
argument-hint: "<bug-key | bug symptom> [--level=P0|P1|P2|P3] [--related=<feature-id>] [--repos=a,b] [--bug-file=<docs-relative.md>]"
---

# /cc-nexs:hotfix

Hotfix uses an independent fix branch and BUG document; it does not consume a shared requirement ID and does not publish a placeholder directory. When the argument is an existing bug-key with `mode=hotfix` or a legacy ID, resume the original task; when the argument is a bug description, first determine the affected repositories and slug, then run:
```text
node <plugin-root>/lib/cc-nexs-cli.mjs init-hotfix <slug> --description "<bug 现象>" [--bug-key YYYYMMDD-slug] [--related <feature-id>] [--repos a,b] [--bug-file <docs-relative.md>]
```
Git Custodian creates `hotfix/<key>` and `.worktrees/<key>/<repo>/` from each repository's latest `origin/<base_branch>`, without reusing the old requirement branch. The command does not call `publishDocsReservation()` and does not create or push README/reservation placeholder files.

- With `--related`, the BUG document is written by default to the related requirement's `doc/<id>.<slug>/bugs/BUG-<key>.md`; the relation does not change the old requirement's status.
- Without a relation, the BUG document is written by default to `hotfix/<key>/BUG-001.md` in the docs repo.
- `--bug-file` can specify a Markdown path inside the docs repo; it must pass path safety validation and must not overwrite existing unrelated documents.
- Authoritative state and configuration live in the workspace's `.cc-nexs/hotfixes/<key>/`. Use `progress.hotfix_document` to locate the BUG file in the docs worktree; the machine state directory must not be treated as the document directory.
- Existing tasks continue to resolve the original `doc/<id>.<slug>/hotfix.md` and the original machine state, and do not need to be re-initialized.

## 1. Classification and Binding

Assign the level based on impact and urgency; P0 is an ongoing production incident, P1 is a critical flow or core data being affected, P2 is a behavioral defect with a bounded scope of impact, and P3 covers fixes such as copy or styling with no behavior change. A single file and 20 lines are only classification references; they cannot prove that there is no behavior change. P0/P1/P2/P3 all require an independent Review.

Fill in the BUG document's `HOTFIX-SCOPE`:

- `intended_paths` must list the actual fix paths; for multiple repos use `repo-id/path`, separated by commas; it must not remain `-`.
- P0/P1 must fill in `affected_acs`, `rollback_owner`, and `rollback_steps`.
- Fill in the local verification matrix inside the scope marker, with the first column as `Check` and the command column as `命令/Driver`. Record a unique check ID and the complete command that will actually be executed; descriptions such as "run the relevant tests" cannot replace the command.
- Changes to ACs, APIs, database schema, permission models, or large-scale refactoring cannot continue as a Hotfix; use `--promote-lean` from Section 4.

Then bind the scope:
```text
node <plugin-root>/lib/cc-nexs-cli.mjs start-hotfix <id> [--level P2] [--related <feature-id>]
```
In this document and throughout, `<id>` refers to the bug-key and is also compatible with legacy Hotfix numbers. This command, together with the fix scope the user has already authorized, constitutes the Hotfix authorization; it does not add a new Gateway A. Once bound, the scope, grading, or verification matrix must not be changed silently; if an adjustment is genuinely necessary, use `revise-hotfix` to record the user authorization already granted.

## 2. Implementation, Local Verification, and Review
```text
INIT -> HOTFIX_IMPLEMENTING -> HOTFIX_IMPLEMENTED -> HOTFIX_LOCAL_VERIFYING
-> HOTFIX_REVIEWING -> PARSE_HOTFIX_REVIEW -> HOTFIX_CANDIDATE_READY
-> HOTFIX_TEST_RELEASE -> HOTFIX_TEST_VERIFYING
-> HOTFIX_TEST_VERIFIED -> HOTFIX_RELEASE_PENDING_HUMAN
-> /approve-release -> HOTFIX_BASE_MERGING -> COMPLETE
```
The Orchestrator calls `nextStep` with `progress.json.mode=hotfix`. Developer, Reviewer, and Verifier each use a dedicated role; review and verification must be performed in independent sessions. During the implementation phase, only the bound paths are modified; Git Custodian records the exact candidate and then executes:
```text
node <plugin-root>/lib/cc-nexs-cli.mjs verify-local <id>
```
If `workflow.local_verify.driver` is present, use the driver; if there is no driver, run the commands in the binding matrix inside the exact candidate worktree, then record the real results with `verify-local <id> --passed|--failed --evidence-json <json>`. Each piece of evidence includes `check`, `command`, an integer `exit_code`, `proof`, and `result`; it must cover the binding matrix and the commands must match. Hotfixes do not allow `deferred_to_test`, and a real failure must not be recorded as a pass. Passed evidence for the same candidate and a valid scope may be reused.

Once all levels pass locally, the work enters an independent centralized Review:
```text
node <plugin-root>/lib/cc-nexs-cli.mjs record-review <id> --passed|--blocked [--finding "P0/P1 ..."]
```
Review checks the complete candidate and invocation surface in one pass; after fixes, enter `HOTFIX_DELTA_REVIEW` and check the corresponding delta with `--closure`. Follow the state machine's existing circuit breakers; for scope revisions already authorized by the user, rebind per Section 4, and do not evade state by hand-editing counters or reopening numbers. P3 has no Review-exempt path.

Each dispatch uses `resolveRoleRuntime(preset, role, runtime, {models: mergedModels, featureConfig, progress: progressV2})`. By default, Developer=`balanced`, Reviewer=`review`, and Verifier=`balanced`; the Reviewer for P0/P1 is automatically routed to `escalated`. The same model with higher effort/thinking, or a different model, is allowed; the hard constraint is session isolation. Explicit overrides in the feature `models.roles` take final precedence, and public defaults do not pin model IDs.

## 3. Test, Gateway B, and Completion

Once ready, run `release-test <id> --hotfix`:
```text
node <plugin-root>/lib/cc-nexs-cli.mjs release-test <id> --hotfix [--retry|--resume]
```
Publish the exact candidate to the configured test only at `HOTFIX_TEST_RELEASE`. `pending` only resumes polling and does not re-trigger CI. The independent Verifier runs the BUG repro, the affected ACs, and smoke tests at the current `environment_revision`, appends the results to the BUG document, and binds the attempt with `record-test-verification`. Fixing a failure produces a new candidate, a new test attempt, and regression evidence; local passing cannot substitute for test acceptance.

Environment, browser, login, or URL limitations are recorded as `manual_required` only after a real test deployment. By default, keep the blocking fact and resume the same attempt; only when the user explicitly authorizes an environment exception may you call `approve-release --test-exception` on the existing Gateway B, providing the authorization record, reason, evidence of the environment limitation, and rollback evidence. An exception requires that the same candidate has already passed local verification and independent Review and that a real test deployment already exists; product test failures, no deployment, or missing evidence cannot use an exception. An exception does not mark the test as passed and does not by default authorize a production deployment.

After normal acceptance, display the scope hash, candidate commits, local evidence, Review, test attempt/environment revision, rollback information, and base targets at `HOTFIX_RELEASE_PENDING_HUMAN`, and wait for `/cc-nexs:approve-release <id>`. An existing user authorization can be recorded by the deterministic controller without adding a redundant confirmation round.

Gateway B's `evidence` comments only append to the document; `implementation` comments invalidate the current evidence, and verification is repeated after the fix. After approval, merge only the same candidate into the configured base. `test -> base`, force push, or re-selecting a candidate from test is prohibited. When base only has updates to non-overlapping paths, keep the accepted candidate unchanged and let release-base integrate them, without re-running the test or approval. Overlapping paths or known cross-file contract dependencies must be handled and verified before release; the absence of textual conflicts cannot be treated as proof of semantic independence.

It is complete only when `HOTFIX_BASE_MERGING -> COMPLETE` and the remote ancestry check passes. The final docs candidate of a new Hotfix contains only this BUG document, with machine state kept in `.cc-nexs/hotfixes/<key>/`; old tasks retain their original set of archived files. Docs are merged last, and the worktree/branch/ref are cleaned up safely. Production release still requires the explicit authorization specified by the organization.

## 4. Same-Fault Revision and Lean Escalation

When the path, severity, or verification command of the same fault needs adjustment and the user has already authorized it, update the BUG scope and then run:
```text
node <plugin-root>/lib/cc-nexs-cli.mjs revise-hotfix <id> --reason "<修订原因>" --authorization-evidence "<已有用户授权记录>"
```
The controller rebinds scope on the original bug-key, original branch, and original worktree, retaining history while clearing current local/Review/test evidence and release approval. Do not hand-edit state or fabricate authorization, and do not claim a new requirement number because P3 is upgraded to P2.

Real contract/schema/permission extensions use the same command plus `--promote-lean`. It creates `<BUGstem>.lean/requirements.md`, `plan.md`, and the migrated state alongside the original BUG, retaining the branch and key; the original local state is saved as `progress.hotfix-history.json` to avoid the same key being resolved twice. The extension can be implemented only after continuing the Lean plan and passing Gateway A, and no new directory is added to claim a requirement number.
