---
description: "Integrate final feature candidates into test, run the project release driver, then hand deployed evidence to the black-box Verifier."
disable-model-invocation: true
allowed-tools: "Read, Bash, Skill, Task, mcp__chrome-devtools__*"
argument-hint: "<feature-id> [--resume | --retry | --dry-run] [--hotfix]"
---

# /cc-nexs:release-test

This is the deterministic test delivery action for an exact candidate. Standard Lean invokes it after Review; eligible fast-track Lean invokes it immediately after deterministic local checks and performs its one Review after test verification. It never targets production.

## Delivery preflight

Before any remote mutation, resolve `release.test` from project config/private overlay and verify only delivery safety:

1. The environment is `test`, never production, and no configured verification URL is production-like.
2. A structured release driver exists and every assigned code repository has an exact candidate ref.
3. At least one repository is approved for `deploy` and has a configured `test_branch`. A Lean repository is local only when its Gateway A-bound plan explicitly contains `test_delivery.<repo>: local`; missing `test_branch` is never silently interpreted as local.
4. Plaintext credentials are absent. Browser provider, login/MFA, app/operations URLs, allowlist completeness, and S3 bucket/CORS/IAM observability are post-deployment verification concerns and must not block the test merge.
5. Lean has exact-fingerprint local evidence (`passed` or structured `deferred_to_test`); standard Lean additionally has an exact-fingerprint passing Review. Fast-track intentionally performs that Review after test verification.

`--hotfix` is accepted only for `mode=hotfix + HOTFIX_TEST_RELEASE`; it never bypasses readiness.

## Deterministic control

After delivery preflight succeeds, resolve the packaged CLI and run:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs release-test <feature-id> [--retry | --dry-run | --hotfix]
```

The controller freezes every candidate SHA and holds a per-feature controller lock. It integrates only `deploy` candidates into the latest `origin/<test_branch>` in temporary worktrees with normal non-force pushes; local candidates remain part of the attempt fingerprint and expose their exact clean worktree for the post-deploy Web harness. It then invokes the structured project release driver with the backward-compatible `operation=release_test` start request and records immutable integration evidence in progress.json.

For CI/CD systems triggered by the test push, the driver should return promptly:

```json
{"status":"pending","pipeline":{"id":"123","url":"https://ci.example/123"}}
```

This persists `delivery.test.status=deploying` and returns control immediately. Resume without another merge or trigger:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs release-test <feature-id> --resume
```

Hotfix resume also includes `--hotfix`.

The same driver receives `operation=release_test_status` plus the previous attempt evidence and returns `pending`, `succeeded`, or `failed`. Combined evidence across start/poll must keep the same non-empty pipeline identity; terminal deployment must name environment `test`, and every deployed repository's `environment_revision` must equal its recorded integration commit.

If a terminal driver failure has moved the workflow to `TEST_RELEASE_BLOCKED` or `HOTFIX_TEST_RELEASE_BLOCKED`, an explicit `--retry` reopens the release state and creates a new attempt. It never retries a still-`deploying` pipeline; that path must use `--resume`.

Only after deployment success does the parent check URLs, allowed hosts, browser/login, and environment-specific behavior. Missing verification capability records `manual_required` and stops in the recoverable `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY` state without undoing the completed test delivery. A real product failure follows the normal test-fix path. Full mode runs accumulated cross-sprint final QA; fast mode runs initial or regression verification based on the release attempt number.

## Explicit opt-out

Legacy fast/full workflows may retain their manual G2 semantics. Lean/Hotfix Gateway B requires an immutable release attempt and therefore does not treat G2 alone as deployed evidence; configure the test release driver and return to `auto_if_ready` to resume. Production release always remains a separate explicit human action.
