---
name: "role-isolation"
description: "Verify the read/write boundaries and independent-session requirements of the current cc-nexs role; applies to dispatched SOP roles."
disable-model-invocation: true
---

# Role Boundaries

First determine the current mode and the dispatched role, then read the corresponding agent file and its read/write contract. Role registration and runtime selection are resolved by `lib/role-registry.mjs`, `lib/runtime-resolver.mjs`, and preset.yml; do not infer a fixed model or tool set from historical role names.

- Implementation, Review, and black-box verification keep independent sessions. Black-box roles use only the inputs permitted by their contract; whether a planning role may read source code is determined by the current agent.
- Write only within the worktree assigned by progress.json and the permitted paths. Roles do not change authoritative state; Git mutations follow `rules/git-custodian-boundary.md`.
- Check boundaries when starting a task or when the task scope changes; do not require repeated verbal self-checks on every tool call.
- On detecting a boundary violation, stop the affected operations and return the paths and facts to the Orchestrator. Preserve existing changes; do not directly `git restore` or rewrite progress to paper over the problem; the properly responsible party distinguishes this round's changes from others' changes before fixing.

`hooks/role-boundary-guard.mjs` uses `CC_NEXS_ROLE` to perform runtime checks; a disabled hook does not mean the boundary is void. This restriction applies only to the current role; it does not extend the SOP gate into a global tool lock for the parent session.
