---
description: "Synchronize changed base into assigned development worktrees and resume verification."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "<feature-id>"
---

# /cc-nexs:sync-base

Run `node <plugin-root>/lib/cc-nexs-cli.mjs sync-base <feature-id>` in BASE_CHANGED or HOTFIX_BASE_CHANGED.
The controller merges upstream in assigned development worktrees, refreshes candidate references and invalidates stale evidence. Clean merges advance directly to local verification without a new planning round. Conflicts remain in the development worktree and route to the active Developer; they are not a human stop. Developer resolves files, Custodian completes the pending merge and refreshes the candidate, then continue verification/independent review/test. Never discard upstream changes or use wholesale ours/theirs. Only material ambiguity requires user input.
