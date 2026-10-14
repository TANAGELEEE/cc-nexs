---
description: "Integrate exact approved candidates into configured base branches and clean worktrees after proof."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "[feature_id]"
---

# /cc-nexs:release-base

Only `/cc-nexs:run` may invoke this after Gateway B. Resolve the packaged CLI and run:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs release-base <feature-id>
```

The controller requires `BASE_MERGING` or Hotfix `HOTFIX_BASE_MERGING`, verifies the approval and scope binding, and merges each exact tested candidate into the latest configured code-repository base using a non-force push. A newer base does not invalidate test evidence by itself: changes with disjoint file paths since the common ancestor can integrate without changing the candidate or repeating test acceptance. Overlapping paths or merge conflicts record `BASE_CHANGED` (Hotfix: `HOTFIX_BASE_CHANGED`) and interrupt only the current push. The orchestrator immediately continues automatic `sync_base` and conflict resolution in the assigned development branch, then verifies the new candidate; this is not a human stop. File disjointness is not proof of semantic independence: known cross-file API/schema/configuration dependencies still require affected integration checks before release. It records partial evidence, verifies remote ancestry, then cleans code feature refs/worktrees only after proof.

The controller also routes disjoint dependency manifests, lockfiles, recognized build/runtime configuration, schema, migration, DTO and contract paths through `BASE_CHANGED` and automatic re-verification. This filename guard is conservative, not a complete dependency graph; custom cross-file coupling still needs affected integration checks.

After the controller succeeds, the orchestrator records the mode-specific merge state `-> COMPLETE`, asks Git Custodian to create one final docs candidate (Lean: requirements/plan plus machine files; new Hotfix: the assigned BUG document only; legacy Hotfix: `hotfix.md` plus its original machine files), then integrates that docs candidate into its configured base branch and cleans the docs worktree. New Hotfix machine files remain in workspace `.cc-nexs/hotfixes/<key>/` and are not staged into docs. No artifact/progress write is permitted after that final docs candidate is created. An approved test-environment exception preserves the unverified test fact; base integration does not imply production deployment authorization. For protected code branches configure `release.base.driver` with `command` and `args`. It receives JSON stdin `{operation: "ensure_merge_request", repository, sourceBranch, sourceCommit, integrationCommit, targetBranch, targetBefore}` and returns `{status: "pending" | "merged", url}`. The driver must idempotently create/find and request merge of the same source/target MR, respecting server protections. The controller pushes only a dedicated integration branch, records pending receipts, and verifies fetched remote ancestry before success; text receipts alone cannot prove a merge. Re-run release-base after pending or a recoverable handoff failure. Squash/rebase merges without exact ancestry are intentionally not accepted. Docs finalization remains a separately proven Custodian operation; never force push.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
