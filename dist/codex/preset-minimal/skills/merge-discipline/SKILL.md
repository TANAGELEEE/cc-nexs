---
name: "merge-discipline"
description: "Prevent role-owned merges and delegate candidate publication and cleanup to Git Custodian."
disable-model-invocation: true
---

# Merge Discipline

Do not merge, rebase, push, or delete branches. After explicit user authorization to merge/push, the release action prepares against latest remote base, merges the candidate, and deletes both remote and local feature refs plus the worktree in the same task. Remote retention is opt-in only; Git Custodian verifies fresh remote ancestry first.
