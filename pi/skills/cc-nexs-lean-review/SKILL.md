---
name: cc-nexs-lean-review
description: /cc-nexs:lean-review 的 Pi P2 适配 skill。 仅允许通过 /cc-nexs:lean-review 或 /skill:cc-nexs-lean-review 显式调用；不得因普通自然语言请求自动触发。 支持 preset-standard lean（默认）、fast 与 full 模式，并通过 pi-subagents 运行隔离角色。 Lean 一次集中 Review 与最多一次 delta 闭环检查。
disable-model-invocation: true
---

# /cc-nexs:lean-review for Pi

Read and follow `../../../dist/preset-standard/commands/lean-review.md` as the authoritative command. Treat the text after `/cc-nexs:lean-review` as its arguments.

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
5. Resolve automatic risk routing once: Lean high/critical upgrades Planner and Reviewer; Hotfix P0/P1 upgrades Reviewer; an explicit feature role profile remains final. Reviewer may use another model or the same model with higher thinking. Encode the selected thinking in each pi-subagents task `model` selector; public files ship no provider-specific model IDs.
6. pi-subagents has no separate per-task `thinking` field. For a non-inherit selection, pass `provider/model:thinking` in the task `model`; for `inherit` with no thinking override, omit `model`; for `inherit` with a thinking override, resolve the active provider/model and append `:thinking`. After `subagent_wait`, retry ordered `fallback_models` only for failed/unavailable tasks in a new bounded parallel call; never rerun successful siblings.
7. Role children never mutate Git or `progress.md` / `progress.json`. The parent owns state transitions and Git Custodian operations, and preserves `CC_NEXS_RUNTIME=pi` plus `CC_NEXS_PLUGIN_ROOT`.



## Required Pi Prerequisites

`pi-subagents` must be installed and its `subagent` tool must expose the package agents above. Run `/subagents-doctor`, then open `/subagents` to inspect package-agent model mappings. `/subagents-models` is only for builtin agents and must not be used for cc-nexs package roles.

After test delivery, automatic verification prefers an onboarded ego lite app plus the `ego-browser` skill and a minimal `ego-browser nodejs` probe. Otherwise it may use `@injaneity/pi-computer-use@0.4.3` with effective `browser_use: true` and `headless: true`. If neither provider or signed-in session is ready, preserve the deployment, record `manual_required`, and resume manual verification later; do not silently claim a pass.
