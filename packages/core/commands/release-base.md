---
description: Integrate exact approved Lean/Hotfix candidates into configured base branches and clean worktrees after proof.
allowed-tools: Read, Bash
argument-hint: [feature_id]
---

# /cc-nexs:release-base

Only `/cc-nexs:run` may invoke this after Gateway B. Resolve the packaged CLI and run:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs release-base <feature-id>
```

The controller requires Lean `BASE_MERGING` or Hotfix `HOTFIX_BASE_MERGING`, verifies the approval and scope binding, fetches every configured code-repository base branch, and refuses with the mode-specific base-changed stop unless each approved candidate contains the latest base. It uses non-force pushes, records partial evidence, verifies remote ancestry, then cleans code feature refs/worktrees only after proof.

After the controller succeeds, the orchestrator records the mode-specific merge state `-> COMPLETE`, asks Git Custodian to create one final docs candidate (Lean: requirements/plan plus machine files; Hotfix: `hotfix.md` plus machine files), then integrates that docs candidate into its configured base branch and cleans the docs worktree. No progress write is permitted after that final docs candidate is created. A protected code/docs branch rejection stops for PR/MR handoff; it must never be bypassed with force push.
