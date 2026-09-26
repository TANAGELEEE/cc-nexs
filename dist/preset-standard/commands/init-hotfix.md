---
description: "Initialize a Hotfix branch and BUG document without reserving a feature number."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "<slug> --description <text> [--bug-key YYYYMMDD-slug] [--related feature-id] [--repos a,b] [--bug-file docs-relative.md]"
---

# /cc-nexs:init-hotfix

Resolve the packaged CLI and run:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs init-hotfix <slug> --description "<bug description>" [--bug-key YYYYMMDD-slug] [--related <feature-id>] [--repos a,b] [--bug-file <docs-relative.md>]
```

Create `hotfix/<key>` and `.worktrees/<key>/<repo>/` from each repository's latest configured remote base. Do not call `publishDocsReservation()`, consume a shared feature number, or commit/push placeholder files.

With `--related`, default the BUG document to the existing feature's `doc/<id>.<slug>/bugs/BUG-<key>.md`; without it, use `hotfix/<key>/BUG-001.md` in the docs repository. An explicit `--bug-file` remains relative to that docs repository and must pass path and collision checks. Keep configuration and authoritative state in workspace `.cc-nexs/hotfixes/<key>/`; `progress.hotfix_document` identifies the BUG document in the assigned docs worktree.

Return the key, BUG document, machine-state path, and branch/worktree assignments. Continue with `/cc-nexs:hotfix <key>` to fill and bind the repair scope. Do not launch requirements brainstorming. Existing Hotfix tasks with `hotfix.md` remain resumable through `/cc-nexs:hotfix <id>`.
