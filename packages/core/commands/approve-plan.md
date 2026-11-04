---
description: "Approve the Lean requirements and plan scope, binding the gate to their hashes."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "[feature_id]"
---

# /cc-nexs:approve-plan

Lean-only human Gateway A. Resolve the packaged CLI and run:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs approve-plan <feature-id>
```

The control requires `PLAN_PENDING_HUMAN`, hashes all of `requirements.md` plus the `APPROVAL-SCOPE` region of `plan.md`, records the approver, and advances to `PLAN_APPROVED`. `--auto` is used only by `/cc-nexs:plan` for a feature initialized with `--auto-plan`; it records `auto-plan` as the approver and refuses, leaving Gateway A to the human, unless the plan is fast-track, low/medium, not blocked by plan review, and free of sensitive task paths. Never edit progress files manually. Continue with `/cc-nexs:run <id>`.
