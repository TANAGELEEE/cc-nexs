---
description: "Invoke Planner subagent to draft or revise spec.md."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Glob, Grep, Task"
argument-hint: "[feature_id] [--revise]"
---

# /cc-nexs-minimal:planner

Invokes `agents/planner.md` via Task tool with subagent_type=general-purpose.

Steps:

1. Locate `doc/<id>/`
2. Set `CC_NEXS_ROLE=planner` for the subagent session
3. Pass agent file content + mode (first-draft vs --revise) as the prompt
4. After subagent returns, check that spec.md exists and contains required sections (Background / Approach / Scope / Acceptance Criteria / Change log). If missing → fail.

Does not modify progress.md (the orchestrator does that).

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
