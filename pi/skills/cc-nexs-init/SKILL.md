---
name: cc-nexs-init
description: /cc-nexs:init 的 Pi P2 适配 skill。 支持 preset-standard fast 模式，并通过 pi-subagents 运行隔离角色。 用模板初始化新需求目录。自动按 all-docs/doc/ 下已有编号续号，自动从需求描述生成 slug。默认在 .worktrees/<id>-<slug>/ 创建独立 git worktree，多需求可并行。
---

# /cc-nexs:init for Pi

Read and follow `../../../dist/preset-standard/commands/init.md` as the authoritative command. Treat the text after `/cc-nexs:init` as its arguments.

## P2 Runtime Contract

1. Pi support is experimental and limited to `preset-standard` fast mode plus the `/cc-nexs:hotfix` bypass. Full orchestration and compound remain unsupported. Do not silently downgrade an existing feature.
2. Use the installed `pi-subagents` tool for every role dispatch. Use package-qualified agents and foreground fresh context:
   - Repo Scout: `cc-nexs.repo-scout`
   - Fullstack: `cc-nexs.fullstack`
   - Reviewer: `cc-nexs.reviewer`
   - Verifier: `cc-nexs.verifier`
3. Never invoke Claude Code, the Claude Task tool, Codex CLI, or a nested `pi` CLI. Legacy invocation snippets in the authoritative command are role task descriptions, not commands to execute in Pi.
4. The Fullstack agent inherits the active Pi default unless the user configured an override. Reviewer and Verifier model selection belongs exclusively to Pi settings under `subagents.agentOverrides`; cc-nexs ships no fixed model IDs.
5. Before the first review or verification dispatch, confirm that `cc-nexs.reviewer` and `cc-nexs.verifier` resolve to an authenticated model different from the implementation model. Accept ordered `fallbackModels`. If the mapping is absent, unavailable, or resolves to the implementation model, stop and explain how to configure it; independent context alone is not heterogeneous review.
6. Role children never mutate Git or progress state. The parent orchestrator owns state transitions and invokes the Git Custodian command itself.
7. Set or preserve `CC_NEXS_RUNTIME=pi` and `CC_NEXS_PLUGIN_ROOT` for shell helpers. Resolve all feature paths through the existing workspace/progress contracts.
8. Preserve the command's artifact locations, human gates, counters, validation, and stop behavior exactly. Runtime adaptation changes dispatch mechanics only.



## Required Pi Prerequisite

`pi-subagents` must be installed and its `subagent` tool must expose the package agents above. Run `/subagents-doctor`, then open `/subagents` to inspect package-agent model mappings. `/subagents-models` is only for builtin agents and must not be used for cc-nexs package roles.
