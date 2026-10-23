---
name: "commit-discipline"
description: "cc-nexs candidate commit constraints. The Git Custodian commits the specified paths, preserving the commit history bound to review and verification."
disable-model-invocation: true
---

# Candidate Commits

Follow `rules/git-custodian-boundary.md`. Roles return the exact modified paths and check results, and the Orchestrator invokes the Git Custodian; this skill does not perform Git mutations directly.

Commits are organized around meaningful implementation boundaries. There is no upper limit on the number of commits, and no automatic squash/rebase at the end of an implementation batch. A candidate that has been used for Review, local verification, or a test attempt remains immutable; code changes produce a new candidate, which is re-verified under the current mode, and old evidence cannot be reused by tidying history.

Commit messages follow the target project's format; when unspecified, use `<type>: <brief description>` and describe the specific change. The Custodian stages only the assigned paths, checks the diff before committing, avoids credentials, and preserves hooks.

Lean/Hotfix documentation is maintained in its own docs worktree; the final docs candidate is generated only after the code base release is proven and the status is COMPLETE. Release, merge, and cleanup are determined by release controls and existing authorization; this skill does not add approvals or remote write permissions.
