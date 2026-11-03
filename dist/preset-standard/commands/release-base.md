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

After the controller succeeds, the orchestrator records the mode-specific merge state `-> COMPLETE` and runs `node <plugin-root>/lib/cc-nexs-cli.mjs finalize-docs <feature-id>`. It creates the one final docs candidate (Lean: requirements/plan plus machine files; new Hotfix: the assigned BUG document only; legacy Hotfix: `hotfix.md` plus its original machine files), integrates it into the docs base through the same route as code (MR driver when configured, otherwise a non-force push), and removes the docs worktree, local and remote branch, and candidate ref after remote proof. It refuses before committing when the docs worktree holds files outside those paths. `pending` means the docs MR awaits merge: rerun the same command; it resumes from Git state. New Hotfix machine files remain in workspace `.cc-nexs/hotfixes/<key>/` and are not staged into docs. No artifact/progress write is permitted after that final docs candidate is created; it keeps the released task's approval and Review evidence. An approved test-environment exception preserves the unverified test fact; base integration does not imply production deployment authorization.

## Protected branches: merge request from the feature branch

For protected bases configure `release.base.driver` with `command` and `args`. The merge request's source is the assigned feature branch (`feature/<id>-<slug>`, Hotfix `hotfix/<key>`) at the exact approved candidate, so the reviewed MR head is the tested commit and no synthetic integration commit or temporary branch is created. The driver receives JSON stdin `{operation: "ensure_merge_request", repository, sourceBranch, sourceCommit, targetBranch, targetBefore}` and returns `{status: "pending" | "merged", url}`. It must:

- push `sourceCommit` to `sourceBranch` itself with a normal non-force push (the controller does not pre-push, so GitLab `merge_request.*` push options take effect on the ref update);
- idempotently create or find the one MR for that source/target pair. When the branch already exists at `sourceCommit`, push options are ignored, so find or create the MR through the server API instead of re-pushing; a diverged remote branch is a failure to report, never a force push;
- respect server protections and never merge with squash or rebase.

Before the driver runs, the controller applies the same overlap and sensitive-path guards as direct pushes; sensitive paths with a `verify_driver` are checked on a local merged tree that is never pushed, and the proof records that tree. A pending receipt is rejected unless `origin/<sourceBranch>` is exactly `sourceCommit` (`MR_SOURCE_DRIFT`). Success requires fetched proof that the target merged the candidate itself: the candidate is on the target's first-parent chain or is a direct parent of a first-parent merge commit. A merge whose source moved beyond the approved candidate is `MR_SOURCE_DRIFT`; text receipts alone never prove a merge. Re-run release-base after pending or a recoverable handoff failure. A rerun keeps the first recorded `target_before` and MR and adds the merge commit and relation. After proof the remote feature branch is deleted with the worktree; never force push.

## Gateway B base preflight

Before stopping at `RELEASE_PENDING_HUMAN` (Hotfix: `HOTFIX_RELEASE_PENDING_HUMAN`), run `node <plugin-root>/lib/cc-nexs-cli.mjs base-preflight <feature-id>`. It fetches each configured base read-only and applies the release guards to the exact candidate. `ready` keeps the state. `base_changed` moves the task to `BASE_CHANGED` (Hotfix: `HOTFIX_BASE_CHANGED`); continue automatic `sync_base` instead of asking for an approval that release-base would reject.

## Incremental integration checks

Projects may configure `release.base.verify_driver: { command, args }` to check a disjoint but sensitive upstream change in an isolated merged worktree without changing the approved candidate ref. It receives JSON `{operation:"verify_base_integration", repository, sourceCommit, targetBefore, integrationCommit, worktree, sensitivePaths}`. Run the affected integration checks against that worktree and return `{status:"passed", integrationCommit, proof}` only with real evidence. The controller verifies the exact merge identity and clean worktree before pushing and records the proof separately from the original test deployment. It never relabels the merged commit as already deployed. This driver must cover the affected runtime/contracts; if a required check needs a new deployment, return a non-passing result and use normal sync/reverification. Path overlap still requires sync and conflict handling. Without a configured driver, conservative sensitive-path behavior remains unchanged.

Configure protected-branch `release.base.driver` when setting up delivery, not after repeated direct push attempts. A reference GitLab driver is in `examples/drivers/gitlab-mr-driver.mjs`. Drivers written for the earlier contract (`cc-nexs-mr-<repo>-<commit>` source branch and an `integrationCommit` field) must be updated. A stable-target push rejection is `PUSH_REJECTED` with the server reason, not `BASE_CHANGED`; repair permissions or the MR route without recreating candidate/test evidence. Driver implementations must consume and validate request identities against current assignments instead of hardcoding a candidate SHA in script source.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
