---
description: Run deterministic Lean/Hotfix local build/start/smoke/E2E and bind evidence to exact candidate commits.
allowed-tools: Read, Bash
argument-hint: [feature_id]
---

# /cc-nexs:verify-local

Resolve the packaged CLI and run:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs verify-local <feature-id>
```

The project must configure `workflow.local_verify.driver`. The driver receives one JSON payload on stdin containing exact candidate commits and repository worktrees. It must build/test, start required frontend/backend services, wait for health, execute smoke/E2E, stop all processes, then return one JSON object:

```json
{"status":"passed","evidence":[{"check":"api-smoke","result":"passed"}]}
```

`failed` returns to implementation; missing driver or malformed evidence blocks the flow. Hotfix also validates its bound scope, and P3 proves exactly one changed file and at most 20 changed lines before its model-Review skip can be used.
