---
name: cc-nexs-evaluator
description: /cc-nexs:evaluator 的 Pi P2 适配 skill。 仅允许通过 /cc-nexs:evaluator 或 /skill:cc-nexs-evaluator 显式调用；不得因普通自然语言请求自动触发。 支持 preset-standard lean（默认）、fast 与 full 模式，并通过 pi-subagents 运行隔离角色。 Evaluator 契约验收入口。新流程默认 final，仅在完整需求发布并通过最终 QA 后全量验收；sprint 仅供 legacy per_sprint。
disable-model-invocation: true
---

# /cc-nexs:evaluator for Pi

Read and follow `../../../dist/preset-standard/commands/evaluator.md` as the authoritative command. Treat the text after `/cc-nexs:evaluator` as its arguments.

## P2 Runtime Contract

Before role dispatch, read `../../../dist/preset-standard/rules/model-discovery.md` and use `cc_nexs_model_gateway` inspect/prepare/start/result. Call `cc_nexs_models` only for missing or invalidated catalogs. Show the non-blocking preview on first use or changes; never wait for a reply. Retain explicit overrides.

1. Pi supports `preset-standard` lean (default), standalone hotfix, fast, and full; unsupported compound flows fail closed rather than downgrade.
2. Call `cc_nexs_dispatch({})` once to detect the installed API. Dispatch a bounded wave using `cc_nexs_dispatch({ tasks: [{ agent: "cc-nexs.tech-lead", task: "<assignment>", cwd: "<assigned absolute worktree>", model: "<frozen provider/model>", effort: "<frozen thinking>" }], concurrency: 1 })`. Include Full QA cases in the first wave. Start every sibling before waiting; never create child worktrees or nested children.

The adapter preserves both APIs:
- `pi-subagents@0.35.1`: one `subagent({ tasks, concurrency, async: true, worktree: false, context: "fresh" })`, then `subagent_wait({ id })`.
- `@tintinweb/pi-subagents@0.14.3`: RPC v2 spawn for each sibling, separate model/thinking fields and actual assigned cwd. The public `Agent` tool has no cwd field; do not substitute it or ask the child to cd. Use installed `cc-nexs.*` role files. Await completion notifications for every returned ID, then collect `get_subagent_result`; no polling or sleeping. The adapter reports partial start failures without discarding already-started IDs.

3. Test merge/CI delivery runs before browser capability selection. Only after deployment, prefer ego lite; otherwise use `@injaneity/pi-computer-use@0.4.3` when effective config has `browser_use: true` and `headless: true`. Missing browser/login/MFA/verification URL capability records recoverable `manual_required` evidence and never blocks or rolls back delivery.
4. Never invoke Claude Code, the Claude Task tool, Codex CLI, or a nested `pi` CLI. Runtime adaptation changes dispatch only; preserve the authoritative command's paths, state transitions, gates, counters, validation, and stop behavior.
5. Resolve automatic risk routing once: Explicit Lean high/critical can upgrade the first Planner dispatch; discovered plan risk upgrades subsequent Reviewer dispatch without starting a second Planner; Hotfix P0/P1 upgrades Reviewer; an explicit feature role profile remains final. Reviewer may use another model or the same model with higher thinking. Use the detected Pi adapter for thinking; public files ship no provider-specific model IDs.
6. The adapter encodes thinking as `provider/model:thinking` only for the tasks API; RPC v2 uses `thinkingLevel`. Omit inherited values. After all children finish, retry ordered `fallback_models` only for failed/unavailable tasks; never rerun successful siblings. Record gateway success only after real successful completion, never after spawn acceptance.
7. Role children never mutate Git or `progress.md` / `progress.json`. The parent owns state transitions and Git Custodian operations, and preserves `CC_NEXS_RUNTIME=pi` plus `CC_NEXS_PLUGIN_ROOT`. For Hotfix children, also pass `CC_NEXS_PROGRESS_FILE` and the resolved `BUG_FILE`; machine-state directories do not determine document paths.



## Required Pi Prerequisites

Install either supported subagent package, then run the local installer and reload Pi. `cc_nexs_dispatch({})` checks the actual tool surface and RPC protocol. The installer supplies translated `cc-nexs.*` agent files for Tintin; it does not replace unrelated custom agents. Legacy tasks users can inspect `/subagents-doctor` and `/subagents`.

After test delivery, automatic verification prefers an onboarded ego lite app plus the `ego-browser` skill and a minimal `ego-browser nodejs` probe. Otherwise it may use `@injaneity/pi-computer-use@0.4.3` with effective `browser_use: true` and `headless: true`. If neither provider or signed-in session is ready, preserve the deployment, record `manual_required`, and resume manual verification later; do not silently claim a pass.
