---
description: Integrate final feature candidates into test, run the project release driver, then hand deployed evidence to the black-box Verifier.
allowed-tools: Read, Bash, Skill, Task, mcp__chrome-devtools__*
argument-hint: <feature-id> [--retry | --dry-run | --hotfix]
---

# /cc-nexs:release-test

This is the deterministic test delivery action for `workflow.sprint_delivery=final_only`. It is invoked by the parent Orchestrator only after all development sprints and the integration review pass. It never targets production.

## Runtime capability preflight

Before any remote mutation, resolve `release.test` from project config/private overlay and verify:

1. The current runtime exposes its configured browser provider: Claude `chrome-devtools-mcp`, Codex current signed-in browser session, or Pi `@injaneity/pi-computer-use@0.4.3`.
2. Reuse the current browser profile, open only configured `allowed_hosts`, and prove the session is authenticated in the test environment. Project instructions/memory may help discover a URL candidate, but automatic execution requires the resolved URL in `release.test` plus its allowlisted host. Do not read plaintext credentials from memory, Markdown, presets, config, or Git. `credential_ref` may name an external secret provider, but secret material must not enter prompts or artifacts.
3. The app and operations URLs identify test, never production. MFA, CAPTCHA, expired login, unavailable browser tools, or host mismatch fail the preflight before any push.
4. If preflight fails, leave progress at `TEST_RELEASE`, report the exact missing prerequisite, and fall back to the manual G2 command. Do not silently skip deployment or testing.

## Deterministic control

After capability preflight succeeds, resolve the packaged CLI and run:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs release-test <feature-id> --capability-attested [--retry | --dry-run | --hotfix]
```

`--capability-attested` may be supplied only after all runtime checks above pass. Without it, the controller fails before mutation; `--dry-run` remains read-only and does not require the flag. The controller requires both configured test URLs, requires a candidate for every assigned code repository, freezes each candidate SHA, and holds a per-feature controller lock. It then integrates candidates into the latest `origin/<test_branch>` in temporary worktrees, uses normal non-force pushes, invokes the structured project release driver once, and records immutable integration/pipeline/deployment/environment evidence in progress.json.

On success, resume `/cc-nexs:run`. Full mode runs accumulated cross-sprint final QA; fast mode runs initial or regression verification based on the release attempt number. On failure, stop in `TEST_RELEASE_BLOCKED`. A deployment that cannot complete browser verification stops in `TEST_DEPLOYED_NEEDS_MANUAL_VERIFY`.

## Explicit opt-out

`/cc-nexs:run <id> --no-auto-test-release` and feature config `release.test=manual` retain the manual G2 path. Production release always remains a separate explicit human action.
