---
description: "Integrate final feature candidates into test, run the project release driver, then hand deployed evidence to the black-box Verifier."
disable-model-invocation: true
allowed-tools: "Read, Bash, Skill, Task, mcp__chrome-devtools__*"
argument-hint: "<feature-id> [--resume [--wait[=<minutes>]] | --retry | --dry-run] [--hotfix]"
---

# /cc-nexs:release-test

This is the deterministic test delivery action for an exact candidate. Lean invokes it after deterministic local checks, and after the consolidated Review when the review policy requires one. It never targets production.

## Delivery preflight

Before any remote mutation, resolve `release.test` from project config/private overlay and verify only delivery safety:

1. The environment is `test`, never production, and no configured verification URL is production-like.
2. A structured release driver exists and every assigned code repository has an exact candidate ref.
3. At least one repository is approved for `deploy` and has a configured `test_branch`. A Lean repository is local only when its Gateway A-bound plan explicitly contains `test_delivery.<repo>: local`; missing `test_branch` is never silently interpreted as local.
4. Plaintext credentials are absent. Browser provider, login/MFA, app/operations URLs, allowlist completeness, and S3 bucket/CORS/IAM observability are post-deployment verification concerns and must not block the test merge.
5. Lean has exact-fingerprint local evidence (`passed` or structured `deferred_to_test`), plus an exact-fingerprint passing Review when the review policy requires one.

`--hotfix` is accepted only for `mode=hotfix + HOTFIX_TEST_RELEASE`; it never bypasses readiness.

## Deterministic control

After delivery preflight succeeds, resolve the packaged CLI and run:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs release-test <feature-id> [--retry | --dry-run | --hotfix]
```

The controller freezes every candidate SHA and holds a per-feature controller lock. It integrates only `deploy` candidates into the latest `origin/<test_branch>` in temporary worktrees with normal non-force pushes; local candidates remain part of the attempt fingerprint and expose their exact clean worktree for the post-deploy Web harness. It then invokes the structured project release driver with the backward-compatible `operation=release_test` start request and records immutable integration evidence in progress.json.

Never merge, rebase, or pull a test branch into a feature branch or its worktree, even to resolve a conflict: test carries other unreleased features that would then ride into the base branch. Resolve test conflicts only through `/cc-nexs:resolve-test-conflict`. The controller refuses a candidate that contains test-only history (`TEST_HISTORY`); rebuild that feature branch from the latest base with only its own commits.

For CI/CD systems triggered by the test push, the driver should return promptly:

```json
{"status":"pending","pipeline":{"id":"123","url":"https://ci.example/123"}}
```

This persists `delivery.test.status=deploying` and returns control immediately. `examples/drivers/gitlab-test-release-driver.mjs` is a reference GitLab driver that reads pipelines through the API, so no browser is needed to observe CI. Where API tokens are not allowed, run it with `--receipts .cc-nexs/runtime/tasks`: it returns `awaiting_receipt` with the exact `record-receipt` command, and the Orchestrator records what the signed-in GitLab pipeline or operations publication page shows. The controller still proves the recorded revision contains the integration. Resume without another merge or trigger:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs release-test <feature-id> --resume --wait
```

`--wait` keeps resuming the same attempt with backoff (30s, 60s, then every 120s) for up to 8 minutes, or `--wait=<minutes>`, and returns as soon as the attempt leaves `deploying`/`awaiting_receipt`; the result reports `waited.polls` and `waited.still_waiting`. Call it again while it is still waiting. It never re-integrates or retriggers.

Hotfix resume also includes `--hotfix`.

The same driver receives `operation=release_test_status` plus the previous attempt evidence and returns `pending`, `succeeded`, or `failed`. Combined evidence across start/poll must name a non-empty pipeline. A later pipeline (another task's push to the same test branch) may take over: when it deploys a test commit containing this integration it proves the candidate, and the earlier pipeline is kept in `superseded_pipelines`. Terminal deployment must name environment `test`, and every deployed repository's `environment_revision` must be its recorded integration commit or a later test commit that contains it (a short SHA is accepted). The controller records the full deployed commit and whether it was `exact` or `contains`.

A driver timeout or missing authenticated CI receipt records `awaiting_receipt`, not a product failure. `--resume` can also recover a legacy failed attempt with complete integration evidence and no product verification failure: it preserves the old reason in recovery history, queries `release_test_status` for that same attempt, and validates pipeline/environment revision before accepting success. It does not start a new deployment.

If a terminal driver failure has moved the workflow to `TEST_RELEASE_BLOCKED` or `HOTFIX_TEST_RELEASE_BLOCKED`, an explicit `--retry` reopens the release state and creates a new attempt. It never retries a still-`deploying` pipeline; that path must use `--resume`.

Only after deployment success does the parent check URLs, allowed hosts, browser/login, and environment-specific behavior. Missing verification capability records `manual_required` and stops in the recoverable `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY` state without undoing the completed test delivery. A real product failure follows the normal test-fix path.

## Explicit opt-out

Lean/Hotfix Gateway B requires an immutable release attempt; a manually handled release is not deployed evidence. Configure the test release driver and return to `auto_if_ready` to resume. Production release always remains a separate explicit human action.

Once all repository integrations are recorded, a driver process/receipt-validation error is an unknown delivery outcome, not proof of product failure. The attempt remains `awaiting_receipt`; fix the driver/receipt and use `--resume` on that attempt, never `--retry` to manufacture another ledger entry. An explicit structured driver `failed` result remains a real failure. Release drivers should return pending receipts promptly, consume the candidate and integration identities from the validated request, and avoid blocking for minutes waiting for a parent-produced file.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
