---
name: using-worktrees
description: Compatibility entry for worktree requests. Delegates all repository topology changes to the Orchestrator-owned Git Custodian.
---

# Worktrees through Git Custodian

Do not run Git mutation commands in this skill. Load `.cc-nexs/workspace.yml`; the Orchestrator must invoke `/cc-nexs:git-custodian reserve` first and may invoke `create` only after the phase-one docs reservation is visible on the remote docs base.

One worktree is created per selected repository at `.worktrees/<id>-<slug>/<repository-id>/`. Custodian fetches the configured `origin/<base>` first and creates the feature with no upstream; the caller's checked-out branch is irrelevant. There is no in-place checkout fallback.
