---
name: cc-nexs-hotfix
description: /cc-nexs:hotfix 的 Pi P2 适配 skill。 仅允许通过 /cc-nexs:hotfix 或 /skill:cc-nexs-hotfix 显式调用；不得因普通自然语言请求自动触发。 支持 preset-standard 独立 Hotfix 分支与 BUG 文档，不占需求号，并通过 pi-subagents 运行隔离角色。 Hotfix：独立修复分支与 BUG 文档、本地验证、独立 Review、test 验收和 Gateway B。
disable-model-invocation: true
---

# /cc-nexs:hotfix for Pi

Read and follow `../../../dist/preset-standard/commands/hotfix.md` as the authoritative command. Treat the text after `/cc-nexs:hotfix` as its arguments.

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

1. Pi supports `preset-standard` lean (default), standalone hotfix, fast, and full; unsupported compound flows fail closed rather than downgrade.
2. Use the installed `pi-subagents@0.35.1` `subagent` tool with package-qualified `cc-nexs.<role>` agents. A Fast/Full implementation batch or wave MUST be one parallel call (include Full QA cases in the first batch), followed by one explicit barrier:

```js
subagent({
  tasks: [
    { agent: "cc-nexs.tech-lead", task: "<assignment task>", cwd: "<assigned repository worktree>", model: "<provider/model:thinking>" },
    { agent: "cc-nexs.qa", task: "<first-wave cases task>", cwd: "<assigned docs worktree>", model: "<provider/model:thinking>" }
  ],
  concurrency: 2,
  async: true,
  worktree: false,
  context: "fresh"
})
subagent_wait({ id: "<async-run-id>" })
```

The example has two tasks, so `concurrency: 2`; for a real batch set it to `min(task count, approved/runtime max_parallel)`. Use only the tasks actually assigned to that batch and set each `cwd` to the progress-assigned worktree. Never issue one `subagent` call per sibling, never wait between sibling starts, never enable Pi-created worktree isolation, and never let a child invoke another child. Non-fanout roles use foreground `subagent({ agent, task, cwd, context: "fresh", model })`.
3. Test merge/CI delivery runs before browser capability selection. Only after deployment, prefer ego lite; otherwise use `@injaneity/pi-computer-use@0.4.3` when effective config has `browser_use: true` and `headless: true`. Missing browser/login/MFA/verification URL capability records recoverable `manual_required` evidence and never blocks or rolls back delivery.
4. Never invoke Claude Code, the Claude Task tool, Codex CLI, or a nested `pi` CLI. Runtime adaptation changes dispatch only; preserve the authoritative command's paths, state transitions, gates, counters, validation, and stop behavior.
5. Resolve one Hotfix model snapshot: P0/P1 automatically routes Reviewer to escalated; an explicit feature role profile remains final. Reviewer may use another model or the same model with higher thinking in a fresh child. Encode thinking in the pi-subagents `model` selector; public files ship no provider-specific model IDs.
6. pi-subagents has no separate per-task `thinking` field. For a non-inherit selection, pass `provider/model:thinking` in the task `model`; for `inherit` with no thinking override, omit `model`; for `inherit` with a thinking override, resolve the active provider/model and append `:thinking`. After `subagent_wait`, retry ordered `fallback_models` only for failed/unavailable tasks in a new bounded parallel call; never rerun successful siblings.
7. Role children never mutate Git or `progress.md` / `progress.json`. The parent owns state transitions and Git Custodian operations, and preserves `CC_NEXS_RUNTIME=pi` plus `CC_NEXS_PLUGIN_ROOT`. For Hotfix children, also pass `CC_NEXS_PROGRESS_FILE` and the resolved `BUG_FILE`; machine-state directories do not determine document paths.

## Pi Hotfix Dispatch Contract

1. Initialize `mode=hotfix` with `init-hotfix`: create `hotfix/<key>` and the assigned BUG without a shared feature number or placeholder push. Resolve the BUG through `progress.hotfix_document`; machine state stays in `.cc-nexs/hotfixes/<key>/`. Legacy `hotfix.md` tasks remain resumable.
2. Bind intended paths, required P0/P1 rollback fields, and actual local verification commands before dispatch. Use fresh `cc-nexs.hotfix-developer`, `cc-nexs.hotfix-reviewer`, and post-deployment `cc-nexs.hotfix-verifier` (or `cc-nexs.hotfix-verifier-computer-use`) sessions. Every severity, including P3, requires independent Review; file/line counts do not prove behavior.
3. Preserve the existing delta Review limit across Review, test, and Gateway B feedback. Use `revise-hotfix` for an already-authorized same-fault revision, retaining key/branch and history while invalidating current evidence. Contract expansion uses `--promote-lean` beside the original BUG and returns to Gateway A without reserving another number.
4. Missing post-deployment verification capability becomes recoverable `manual_required`. Only explicit user authorization through `approve-release --test-exception` may accept that real deployed environment gap with passed exact local/Review evidence and rollback proof. Preserve the test gap; the exception does not authorize production deployment. Never merge test into base or force push.


## Required Pi Prerequisites

`pi-subagents` must be installed and its `subagent` tool must expose the package agents above. Run `/subagents-doctor`, then open `/subagents` to inspect package-agent model mappings. `/subagents-models` is only for builtin agents and must not be used for cc-nexs package roles.

After test delivery, automatic verification prefers an onboarded ego lite app plus the `ego-browser` skill and a minimal `ego-browser nodejs` probe. Otherwise it may use `@injaneity/pi-computer-use@0.4.3` with effective `browser_use: true` and `headless: true`. If neither provider or signed-in session is ready, preserve the deployment, record `manual_required`, and resume manual verification later; do not silently claim a pass.
