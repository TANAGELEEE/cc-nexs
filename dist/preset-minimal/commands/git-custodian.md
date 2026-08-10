---
description: "Sole Git mutation boundary for multi-repository worktrees, candidate commits, merge verification, and safe cleanup."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "<reserve|create|candidate|prepare|cleanup|finalize> <feature-id>"
---

# /cc-nexs:git-custodian

Only the Orchestrator may invoke this command. Implementation, review, and QA roles must not run branch, merge, push, worktree-removal, or branch-deletion commands.

Load `.cc-nexs/workspace.yml` with `loadWorkspaceConfig()` and use `git-custodian.mjs`. After create, persist each returned `baseBranch` and `baseCommit` in progress.json. Later prepare/cleanup actions use that recorded base branch and fail if the workspace mapping changed unexpectedly.

- `reserve`: call `publishDocsReservation()` before any code worktree is created. This is the sole narrow exception that may commit and fast-forward push directly to the docs base: it may only create a previously absent `doc/<id>.<slug>/README.md` and `.cc-nexs-reservation.json`; it may never edit existing paths, force-push, or fall back to a local-only number. This phase-one commit makes the number visible to developers who do not use cc-nexs.
- `create`: fetch the configured remote base, then create one same-named feature branch with no upstream and one isolated worktree per selected repository under `.worktrees/<id>-<slug>/<repo-id>/`. Never branch from the caller's current checkout.
- `candidate`: stage only explicitly declared paths and call `commitCandidate(..., progressFile)`. Candidate identity is written to progress.json **before** the commit with `commit: null`; the immutable `refs/cc-nexs/candidates/<feature>/<repo>` ref is the commit authority. Never write the resulting SHA back into progress.json, because that creates an uncommittable self-reference and leaves the docs worktree dirty forever. Test release resolves and freezes that ref before mutation, then rejects any ref movement observed during integration.
- `prepare`: immediately before creating/merging an MR/PR, call `prepareFeatureForMerge()`. It fetches latest `origin/<base>`, requires a clean worktree, merges the latest base into the feature branch without rewriting published history, and advances the candidate ref. This is the only automatic base synchronization after init; ordinary candidate commits never run `git pull`.
- `cleanup`: local-only maintenance. Run after merge proof to remove the worktree, local feature branch, and candidate ref while retaining any remote feature branch. Use this only when the user has not authorized a complete release merge.
- `finalize`: when the user explicitly asks to merge/push to `master` or otherwise authorizes release, call `finalizeMergedWorktree()` for every code repository first and the docs repository last. It fetches both remote refs, proves the remote feature tip is reachable from the remote base, deletes the remote feature branch, then removes the local worktree, local feature branch, and candidate ref. Remote retention requires an explicit user instruction such as `--keep-remote`; it is no longer the default for an authorized merge. Leaving any local or remote feature branch behind is a failed release lifecycle.

The docs repository uses two phases. Phase one is the constrained reservation commit above. Phase two follows the normal candidate protocol: during release, merge code repositories first, write their actual integration commit ids into the final docs artifacts if needed, then create/prepare/merge the docs candidate last. The number is already visible on the shared docs base throughout development.

Remote branch deletion is never inferred from `COMPLETE` alone. It is inferred from the user's explicit authorization to merge/push the feature into the configured base. After that merge succeeds, finalize performs complete local and remote cleanup unless the user explicitly asks to retain the remote branch.
