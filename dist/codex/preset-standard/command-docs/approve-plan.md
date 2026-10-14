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

The control requires `PLAN_PENDING_HUMAN`, hashes all of `requirements.md` plus the `APPROVAL-SCOPE` region of `plan.md`, records the approver, and advances to `PLAN_APPROVED`. Never edit progress files manually. Continue with `/cc-nexs:run <id>`.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
