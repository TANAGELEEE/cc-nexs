---
name: branch-gate
description: Compatibility guard that verifies the current worktree assignment without creating or changing branches.
---

# Branch Gate

Read progress.json and verify the current path and branch match its repository assignment. If they do not match, stop. Branch creation and switching belong exclusively to Git Custodian.
