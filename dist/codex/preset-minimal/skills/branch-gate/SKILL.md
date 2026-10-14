---
name: "branch-gate"
description: "Verify an existing Git Custodian worktree assignment; never create or switch branches from a role."
disable-model-invocation: true
---

# Branch Gate

Compare the current path and branch with progress.json. Stop on mismatch. All Git mutations belong to Git Custodian.
