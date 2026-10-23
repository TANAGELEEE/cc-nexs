---
name: "using-cc-nexs"
description: "Guides new features, cross-module requirements, full development-test acceptance, or 'run by the SOP' requests into cc-nexs. New requirements default to lean, with support for a single consolidated Review, test release, automated browser acceptance, manual fallback, and hotfix triage."
disable-model-invocation: true
---

# Using cc-nexs

Use `commands/*.md` as the source of truth for the workflow. Claude Code, Codex, and Pi only adapt entry points and role tooling; they must not fork state, artifacts, or Git semantics.

## Choosing an entry point

- Standard new feature: default to `init -> plan -> Gateway A -> run -> Gateway B` with `mode=lean`.
- High risk or complex DB/external contracts stay in Lean with a high/critical risk tier; split a requirement that cannot be reviewed and verified as one plan into separately approved Lean requirements.
- Bounded, small-scope BUG: run `hotfix <symptom>` directly to create a latest-base `hotfix/<key>` and a BUG document without consuming a requirement number; `init --mode=hotfix` only provides compatibility forwarding to `init-hotfix`. For authorized revisions to the same failure, use `revise-hotfix`; for contract/schema/permission extensions, add `--promote-lean` to convert to Lean alongside the original BUG and pass through Gateway A.
- Exploratory spikes or pure documentation tasks are not required to enter the main workflow.

## Starting
```text
/cc-nexs:init <需求> [--mode=lean|hotfix]
/cc-nexs:brainstorm <id>          # requirements 模糊时可选
/cc-nexs:plan <id>                # lean 默认；输出 HTML 后停 Gateway A
/cc-nexs:approve-plan <id>
/cc-nexs:run <id>                 # 实现、本地验证、一次集中 Review、test 验收
```
Codex uses the `$cc-nexs-*` mirror skill; do not treat `/cc-nexs:*` as a shell path. Pi/Claude uses slash commands.

## Default delivery

New Lean requirements default to:
```yaml
workflow:
  test_release:
    policy: auto_if_ready
```
- Maintain only the two human-authored documents `requirements.md` and `plan.md`; HTML is a temporary rendering artifact.
- Implement in parallel according to the plan's path ownership; complete items that can be executed locally, and items limited by the environment may be structured as `deferred_to_test`. For fast-track, do test/CI and acceptance first, then a single independent consolidated Review; standard remains Review-first.
- A Review block permits only one delta closure after fixes; test failures likewise require re-running local verification, delta closure, and release.
- After test acceptance passes, stop at Gateway B; only `/cc-nexs:approve-release` authorizes merging into the configured base branch.
- `--no-auto-test-release` or the feature `release.test=manual` explicitly switches to a manual test handoff.
- Stop before push only when delivery-safety prerequisites such as the test environment, candidate, deploy test branch, or release driver are insufficient. browser/login/verification URL are checked only after deployment; if missing, enter the recoverable `manual_required`.
- Production merge/release is always manual.

## Post-deployment Browser Acceptance

- Claude Code: `chrome-devtools-mcp` is callable.
- Codex: reuse the currently logged-in in-app/Chrome session.
- Pi: prefer installing and completing the ego lite onboarding plus the `ego-browser` skill; when on Windows or when ego lite is unavailable, install `@injaneity/pi-computer-use@0.4.3` and set `browser_use: true` and `headless: true` in `.pi/computer-use.json`. If neither is available, keep the completed test delivery and let verification enter `manual_required`.

Access only `release.test.allowed_hosts`. URLs may be discovered from project documentation, but must be entered into the structured `release.test` configuration before automated execution. Reading plaintext usernames or passwords from memory, Markdown, Git, or config is prohibited; prefer reusing existing logins, and when necessary use only an opaque `credential_ref` to connect to an external secret provider.

## Manual Checkpoints

1. Lean Gateway A: approve the hash binding of requirements + plan.
2. Lean Gateway B: approve the exact candidate fingerprint that has passed consolidated Review, local verification, and test acceptance.
3. Hotfix Gateway B: after test black-box acceptance passes, approve merging the exact candidate into base.

Gates only pause cc-nexs role dispatch; they do not block the parent session's user-authorization tools.

## Runtime Command Mapping
```text
run                 主编排
plan                Lean 计划 + HTML
approve-plan        Lean Gateway A
verify-local        确定性本地集成验证
lean-review         一次集中 Review / 一次 delta closure
approve-release     Lean/Hotfix Gateway B
release-base        批准后确定性合并 base
release-test        确定性合入 test + release driver
status              只读状态和 release evidence
doctor --release-test 严格发布前置检查
hotfix              独立 P0/P1/P2/P3 mini-Lean：scope binding -> local -> one Review -> test -> Gateway B
```
Single-step role commands do not advance progress; only `run`/deterministic core controls can advance or record events.

## Startup Checks

- The workspace/repository worktree and branch assignment are correct;
- requirements, config.mode, and progress mode are consistent;
- Lean uses the configured `workflow.local_verify.driver`, or, when it is missing, runs the plan-approved command and records structured command/exit/proof; Hotfix may also execute the actual command bound to the matrix and register the same structured evidence, and must not defer it to test. Both keep the approved plan or bound Hotfix scope unchanged; authorized revisions are rebound through the deterministic controller;
- The automated test release project has test_branch and driver configured for the deploy repository; the Lean local repository is explicitly bound in the approved plan;
- test URLs, allowed_hosts, and browser prerequisites are verified after deployment; when missing, recoverable manual verification is accepted, and delivery is not rolled back.
