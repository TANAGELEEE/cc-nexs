---
name: merge-discipline
description: Compatibility guard for merge requests. Roles never merge; release automation or a human merges candidates, then Git Custodian verifies and cleans up.
---

# Merge Discipline

Roles and ordinary orchestration must not merge, rebase, push, or delete branches. Record candidate refs and stop at the release gate. If the user explicitly authorizes merging/pushing to the configured base, the release action runs Custodian prepare, merges code repositories before docs, then performs complete finalize cleanup in the same task: remote feature, local feature, worktree, and candidate ref. Retain the remote feature only when the user explicitly requests it.
