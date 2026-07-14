---
name: git-custodian-boundary
description: Roles write artifacts; only the Orchestrator-owned Git Custodian may stage, commit, publish, merge, or clean worktrees.
---

# Git Custodian Boundary

Implementation, planning, review, QA, and evaluator roles may inspect Git state but must not mutate repository topology or history.

Roles must not run `git add`, `git commit`, `git push`, `git merge`, `git rebase`, branch creation/deletion, or worktree creation/removal. They return an exact list of changed paths to the Orchestrator.

The Orchestrator delegates Git mutations to `git-custodian.mjs`, which:

1. uses the repository and base branch declared in `.cc-nexs/workspace.yml`;
2. stages only explicitly named paths;
3. records candidate commits in progress.json and `refs/cc-nexs/candidates/`;
4. never commits directly to a protected base branch;
5. removes worktrees and local branches only after clean-worktree and merged-ancestor proof;
6. never deletes a remote branch without an explicit release action.

This separation is not Orchestrator overreach: the Orchestrator owns workflow coordination, while Git Custodian is a narrow, auditable capability boundary. It cannot edit role artifacts or approve gates.
