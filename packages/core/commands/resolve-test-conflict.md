---
description: "Continue test delivery after a real test branch merge conflict."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "<feature-id> [--progress <path>]"
---

# /cc-nexs:resolve-test-conflict

Run `node <plugin-root>/lib/cc-nexs-cli.mjs resolve-test-conflict <feature-id>` after the assigned Developer resolves the files in the reported test integration worktree. The controller verifies there are no unmerged files, creates the merge commit, pushes the exact target branch, proves remote ancestry, reuses the same test attempt, and returns to `TEST_RELEASE`. It never creates a second deployment attempt. The default conflict worktree is an isolated test integration worktree. If product compatibility changes are required, implement them on the original assigned feature branch and prepare a fresh candidate through local verification and independent review; never import unrelated test-only commits into that branch. For an integration-only conflict, resolve and stage only the reported files in the recorded integration worktree, preserving both sides' intent. After resolution run `release-test --resume` (plus `--hotfix` in Hotfix mode) to continue the same attempt. A missing driver is a configuration blocker, not a product test failure.
