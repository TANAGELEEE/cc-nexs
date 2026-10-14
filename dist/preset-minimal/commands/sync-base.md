---
description: "Synchronize changed base into assigned development worktrees and resume verification."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "<feature-id>"
---

# /cc-nexs:sync-base

Run `node <plugin-root>/lib/cc-nexs-cli.mjs sync-base <feature-id>` in BASE_CHANGED or HOTFIX_BASE_CHANGED.
The controller merges upstream in assigned development worktrees, refreshes candidate references and invalidates stale evidence. Clean merges advance directly to local verification without a new planning round. Conflicts remain in the development worktree and route to the active Developer; they are not a human stop. Developer resolves files, Custodian completes the pending merge and refreshes the candidate, then continue verification/independent review/test. Never discard upstream changes or use wholesale ours/theirs. Only material ambiguity requires user input.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
