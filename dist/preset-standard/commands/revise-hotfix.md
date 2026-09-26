---
description: "Record authorized Hotfix scope revisions in place, or promote the same repair to Lean."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash"
argument-hint: "<bug-key> --reason <text> --authorization-evidence <text> [--promote-lean]"
---

# /cc-nexs:revise-hotfix

Use the user's existing authorization for a revision of the same fault. Update the assigned BUG document's scope, then invoke the deterministic controller:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs revise-hotfix <bug-key> --reason "<reason>" --authorization-evidence "<existing user authorization>" [--promote-lean]
```

Without `--promote-lean`, rebind the authorized scope, severity, paths, and local verification matrix in the existing branch/worktrees. Clear current candidate evidence and release approval while retaining history. Do not allocate a feature number, restart in another branch, fabricate authorization, or edit counters to bypass a stop.

For contract, schema, permission, or broad scope expansion, use `--promote-lean`. The controller creates `<BUGstem>.lean/` beside the BUG document with `requirements.md`, `plan.md`, and migrated state, retaining the key and branch. The old local progress becomes `progress.hotfix-history.json`. Complete Lean planning and Gateway A before implementing the expanded scope. Existing user authorization to prepare the revision does not substitute for the exact plan binding.
