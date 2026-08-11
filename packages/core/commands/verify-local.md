---
description: "Run deterministic Lean/Hotfix local build/start/smoke/E2E and bind evidence to exact candidate commits."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "[feature_id] [--passed|--failed|--deferred-to-test] [--evidence-json <json>]..."
---

# /cc-nexs:verify-local

Resolve the packaged CLI and run:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs verify-local <feature-id>
```

When the project configures `workflow.local_verify.driver`, the driver receives one JSON payload on stdin containing exact candidate commits and repository worktrees. It runs every locally possible build/test/start/smoke/E2E check, stops all processes, then returns one JSON object:

```json
{"status":"passed","evidence":[{"check":"api-smoke","result":"passed"}]}
```

When a Lean candidate cannot start or reach required shared infrastructure locally, all executable checks still run and the unavailable checks may be deferred explicitly:

```json
{
  "status": "deferred_to_test",
  "evidence": [
    {"check":"backend-compile","result":"passed"},
    {"check":"backend-start","result":"deferred_to_test","reason":"required shared infrastructure is unavailable locally","test_action":"require CI build/deploy success and run the API smoke in test"}
  ]
}
```

If no driver is configured, Lean does not need a new project-level script for a small change. The parent runs the plan-approved commands in the exact candidate worktrees and records their real results:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs verify-local <feature-id> --deferred-to-test \
  --evidence-json '{"check":"backend-compile","result":"passed","command":"mvn -q -DskipTests package","exit_code":0,"proof":"BUILD SUCCESS"}' \
  --evidence-json '{"check":"backend-start","result":"deferred_to_test","reason":"shared infrastructure unavailable locally","test_action":"deploy to test and run API smoke"}'
```

Use `--failed` with an actually executed nonzero command when a compile, unit, or lint check fails. A failed item requires `check`, the exact `command`, a nonzero integer `exit_code`, and non-empty `proof`; it routes back to the appropriate repair state instead of advancing or reusing stale success.

This fallback requires at least one actually executed passed command with `check`, `command`, `exit_code=0`, and `proof`; it is rejected when a driver exists, so it cannot silently bypass the project contract. `deferred_to_test` is Lean-only. It requires at least one structured deferred item, allows only `passed|deferred_to_test`, rejects duplicate checks, is cached for the exact fingerprint, and advances to test delivery without redispatching a Developer. A real compile/unit/lint failure is always `failed`; it cannot be relabeled as an environment limitation. Every deferred `check` must later be closed by exact structured passing test evidence. Hotfix still requires the configured driver and `passed`, validates its bound scope, and P3 proves exactly one changed file and at most 20 changed lines before its model-Review skip can be used.
