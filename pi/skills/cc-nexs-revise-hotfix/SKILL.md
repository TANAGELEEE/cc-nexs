---
name: cc-nexs-revise-hotfix
description: /cc-nexs:revise-hotfix Pi P2 adapter skill. Invoke only through /cc-nexs:revise-hotfix or /skill:cc-nexs-revise-hotfix; never auto-trigger from ordinary natural-language requests. Supports the preset-standard standalone Hotfix branch and BUG document without consuming a requirement number, with isolated roles through pi-subagents. Record authorized Hotfix scope revisions in place, or promote the same repair to Lean.
disable-model-invocation: true
---

# /cc-nexs:revise-hotfix for Pi

Read and follow `../../../dist/preset-standard/commands/revise-hotfix.md` as the authoritative command. Treat the text after `/cc-nexs:revise-hotfix` as its arguments.

## Deterministic Hotfix Controls

Resolve `../../../packages/core/lib/cc-nexs-cli.mjs` relative to this SKILL.md. Follow the authoritative command for the applicable initialization, binding, or authorized revision action:

```text
node <resolved-cli-path> init-hotfix <slug> --description "<bug description>" [--bug-key YYYYMMDD-slug] [--related <feature-id>] [--repos a,b] [--bug-file <docs-relative.md>]
node <resolved-cli-path> start-hotfix <bug-key-or-legacy-id> [--level P0|P1|P2|P3] [--related <feature-id>]
node <resolved-cli-path> revise-hotfix <bug-key-or-legacy-id> --reason "<reason>" --authorization-evidence "<existing user authorization>" [--promote-lean]
```

New Hotfix tasks use `hotfix/<key>` and one assigned BUG document; never reserve a shared feature number or publish placeholders. Resolve the BUG through `progress.hotfix_document` and keep machine state in `.cc-nexs/hotfixes/<key>/`; legacy `hotfix.md` tasks remain resumable. Every severity, including P3, requires independent Review. Authorized revisions retain the key/branch and invalidate current evidence; Lean promotion still requires Gateway A.

Subsequent local verification, Review recording, test release/verification, release approval, and base integration must use the packaged controls named by the authoritative command. Only an explicitly authorized `approve-release --test-exception` may accept an actual deployed `manual_required` environment gap with exact local/Review and rollback evidence; it preserves the unverified fact and does not authorize production deployment. Never edit progress state or perform ad hoc merge/push operations.

## P2 Runtime Contract

Before role dispatch, read `../../../dist/preset-standard/rules/model-discovery.md` and use `cc_nexs_model_gateway` inspect/prepare/start/result. Call `cc_nexs_models` only for missing or invalidated catalogs. Show the non-blocking preview on first use or changes; never wait for a reply. Retain explicit overrides.

1. Pi supports `preset-standard` lean (default) and standalone hotfix; unsupported compound flows fail closed rather than downgrade.
2. Call `cc_nexs_dispatch({})` once to detect the installed API. Dispatch a bounded wave using `cc_nexs_dispatch({ tasks: [{ agent: "cc-nexs.lean-developer", task: "<assignment>", cwd: "<assigned absolute worktree>", model: "<frozen provider/model>", effort: "<frozen thinking>" }], concurrency: 1 })`. Start every sibling before waiting; never create child worktrees or nested children.

The adapter preserves both APIs:
- `pi-subagents@0.35.1`: one `subagent({ tasks, concurrency, async: true, worktree: false, context: "fresh" })`, then `subagent_wait({ id })`.
- `@tintinweb/pi-subagents@0.14.3`: RPC v2 spawn for each sibling, separate model/thinking fields and actual assigned cwd. The public `Agent` tool has no cwd field; do not substitute it or ask the child to cd. Use installed `cc-nexs.*` role files. Await completion notifications for every returned ID, then collect `get_subagent_result`; no polling or sleeping. The adapter reports partial start failures without discarding already-started IDs.

3. Test merge/CI delivery runs before browser capability selection. Only after deployment, prefer ego lite; otherwise use `@injaneity/pi-computer-use@0.4.3` when effective config has `browser_use: true` and `headless: true`. Missing browser/login/MFA/verification URL capability records recoverable `manual_required` evidence and never blocks or rolls back delivery.
4. Never invoke Claude Code, the Claude Task tool, Codex CLI, or a nested `pi` CLI. Runtime adaptation changes dispatch only; preserve the authoritative command's paths, state transitions, gates, counters, validation, and stop behavior.
5. Resolve one Hotfix model snapshot: P0/P1 automatically routes Reviewer to escalated; an explicit feature role profile remains final. Reviewer may use another model or the same model with higher thinking in a fresh child. Use the detected Pi adapter for thinking; public files ship no provider-specific model IDs.
6. The adapter encodes thinking as `provider/model:thinking` only for the tasks API; RPC v2 uses `thinkingLevel`. Omit inherited values. After all children finish, retry ordered `fallback_models` only for failed/unavailable tasks; never rerun successful siblings. Record gateway success only after real successful completion, never after spawn acceptance.
7. Role children never mutate Git or `progress.md` / `progress.json`. The parent owns state transitions and Git Custodian operations, and preserves `CC_NEXS_RUNTIME=pi` plus `CC_NEXS_PLUGIN_ROOT`. For Hotfix children, also pass `CC_NEXS_PROGRESS_FILE` and the resolved `BUG_FILE`; machine-state directories do not determine document paths.

## Pi Hotfix Dispatch Contract

1. Initialize `mode=hotfix` with `init-hotfix`: create `hotfix/<key>` and the assigned BUG without a shared feature number or placeholder push. Resolve the BUG through `progress.hotfix_document`; machine state stays in `.cc-nexs/hotfixes/<key>/`. Legacy `hotfix.md` tasks remain resumable.
2. Bind intended paths, required P0/P1 rollback fields, and actual local verification commands before dispatch. Use fresh `cc-nexs.hotfix-developer`, `cc-nexs.hotfix-reviewer`, and post-deployment `cc-nexs.hotfix-verifier` (or `cc-nexs.hotfix-verifier-computer-use`) sessions. Every severity, including P3, requires independent Review; file/line counts do not prove behavior.
3. Preserve the existing delta Review limit across Review, test, and Gateway B feedback. Use `revise-hotfix` for an already-authorized same-fault revision, retaining key/branch and history while invalidating current evidence. Contract expansion uses `--promote-lean` beside the original BUG and returns to Gateway A without reserving another number.
4. Missing post-deployment verification capability becomes recoverable `manual_required`. Only explicit user authorization through `approve-release --test-exception` may accept that real deployed environment gap with passed exact local/Review evidence and rollback proof. Preserve the test gap; the exception does not authorize production deployment. Never merge test into base or force push.


## Required Pi Prerequisites

Install either supported subagent package, then run the local installer and reload Pi. `cc_nexs_dispatch({})` checks the actual tool surface and RPC protocol. The installer supplies translated `cc-nexs.*` agent files for Tintin; it does not replace unrelated custom agents. Legacy tasks users can inspect `/subagents-doctor` and `/subagents`.

After test delivery, automatic verification prefers an onboarded ego lite app plus the `ego-browser` skill and a minimal `ego-browser nodejs` probe. Otherwise it may use `@injaneity/pi-computer-use@0.4.3` with effective `browser_use: true` and `headless: true`. If neither provider or signed-in session is ready, preserve the deployment, record `manual_required`, and resume manual verification later; do not silently claim a pass.
