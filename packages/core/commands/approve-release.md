---
description: "Approve the exact Lean or Hotfix candidate verified in test before base-branch integration."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "[feature_id]"
---

# /cc-nexs:approve-release

Lean/Hotfix human Gateway B. Resolve the packaged CLI and run:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs approve-release <feature-id>
```

The control requires Lean `RELEASE_PENDING_HUMAN` or Hotfix `HOTFIX_RELEASE_PENDING_HUMAN`, and a verified test attempt bound to the same candidate fingerprint. It requires one consolidated Review, except P3 may substitute deterministic single-file/20-line/non-behavioral proof. Approval binds candidate commits, test attempt, environment revision, and the plan or hotfix-scope hash. Any later candidate change invalidates it. Continue with `/cc-nexs:run <id>` to integrate configured base branches.
