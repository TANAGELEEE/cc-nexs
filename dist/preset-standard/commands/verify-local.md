---
description: "Run the fast Lean/Hotfix pre-deployment checks and bind evidence to exact candidate commits."
disable-model-invocation: true
allowed-tools: "Read, Bash, mcp__chrome-devtools__*"
argument-hint: "[feature_id] [--preflight|--passed|--failed|--deferred-to-test] [--evidence-json <json>]..."
---

> The user invoked this command and its instructions are loaded below: follow them now. Do not call the Skill tool for it.

# /cc-nexs:verify-local

Resolve the packaged CLI and run:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs verify-local <feature-id>
```

Local verification is a fast check before deployment; acceptance in the test environment remains the main gate. The bound matrix should stay small:

- Frontend: lint, type check, targeted tests, and a browser check of each affected page.
- Backend: targeted tests for the changed behavior.
- Full production build: only when the change touches build configuration, dependencies, or lockfiles; route generation, publication, or translation checks run their own generator or validator. CI builds every test release.

When the project configures `workflow.local_verify.driver`, the driver receives one JSON payload on stdin containing exact candidate commits, repository worktrees, `scratch_dir`, and `artifacts_dir`. It runs the bound matrix, stops all processes, then returns one JSON object:

```json
{"status":"passed","evidence":[{"check":"api-smoke","result":"passed","command":"./scripts/api-smoke.sh","exit_code":0,"proof":"smoke passed"}]}
```

When a Lean candidate cannot start or reach required shared infrastructure locally, all executable checks still run and the unavailable checks may be deferred explicitly:

```json
{
  "status": "deferred_to_test",
  "evidence": [
    {"check":"backend-compile","result":"passed","command":"mvn -q -DskipTests package","exit_code":0,"proof":"BUILD SUCCESS"},
    {"check":"backend-start","result":"deferred_to_test","reason":"required shared infrastructure is unavailable locally","test_action":"require CI build/deploy success and run the API smoke in test"}
  ]
}
```

## Attempt artifacts

Each driver run gets one controller-owned directory, `.cc-nexs/runtime/verify/<task>/<attempt>/`:

- `scratch/` (`scratch_dir`): anything rebuildable, such as a source export, dependency install, or `.next` output. The controller removes it when the attempt ends, on success and failure alike, after recording evidence.
- `artifacts/` (`artifacts_dir`): logs, hashes, and reports the driver wants to keep. Evidence that points at a file must point here.
- `driver.stdout.log`, `driver.stderr.log`, and `receipt.json`: the controller's own record of the attempt, including log hashes and what happened to scratch. They are kept.

Prefer checks in the candidate worktree; use `scratch_dir` only when a check needs a separate copy. The controller keeps scratch when it holds a dirty Git checkout or when the driver's result names `scratch_dir`, and records why in the receipt.

## Free space

Before a driver run the controller checks the workspace and every candidate worktree volume against `workflow.local_verify.min_free_gb` (default 10; 0 disables the check). When a volume is below it, the controller removes scratch left by inactive attempts once and measures again. If a volume is still too low, verify-local stops with a blocker that names it. That blocker is not a verification failure: no attempt is recorded and no repair state applies. Stop, report it, and rerun only after space is freed. Never move outputs to another disk to get past it. Worktrees and logs are reclaimed only through `/cc-nexs:git-custodian reclaim`.

Without a driver, run `verify-local <feature-id> --preflight` before the matrix commands. It applies the same check and records nothing.

## Direct evidence

If no driver is configured, Lean and Hotfix can use direct evidence without creating a project-level script. The parent runs Lean plan-approved commands or Hotfix scope-bound commands in the exact candidate worktrees and records their real results. For example, the following Lean-only deferral must use the actual commands from the approved matrix:

```text
node <plugin-root>/lib/cc-nexs-cli.mjs verify-local <feature-id> --deferred-to-test \
  --evidence-json '{"check":"backend-compile","result":"passed","command":"mvn -q -DskipTests package","exit_code":0,"proof":"BUILD SUCCESS"}' \
  --evidence-json '{"check":"backend-start","result":"deferred_to_test","reason":"shared infrastructure unavailable locally","test_action":"deploy to test and run API smoke"}'
```

A matrix command that starts with `browser:` is a browser check, written as `browser: <start command> @ <page path>`. The parent Orchestrator starts the exact candidate worktree, opens the page with the runtime browser provider, compares it with the row's pass criteria, and stops the process. Navigation stays on the local origin and `release.test.allowed_hosts`, and any backend it reaches must be a test backend, never production. Record the observation without an exit code; `command` must equal the matrix cell:

```json
{"check":"LV-002","result":"passed","method":"browser","command":"browser: pnpm dev @ /settings","proof":"footer stays above the fold at 375px"}
```

A browser row cannot pass as a command row or the reverse, and a passing result still needs one executed command. A configured driver must return this evidence for browser rows itself. When the page needs a backend change that is not deployed, or the parent has no browser provider or login, Lean records `deferred_to_test`; Hotfix rebinds the row with `revise-hotfix`.

Use `--failed` with an actually executed nonzero command when a compile, unit, or lint check fails. A browser check that shows the wrong behavior is `failed` with the same `method`, `command`, and `proof` fields. A failed item requires `check`, the exact `command`, a nonzero integer `exit_code`, and non-empty `proof`; it routes back to the appropriate repair state instead of advancing or reusing stale success.

A check that fails the same way on the candidate's merge-base is recorded with `--passed` (or `--deferred-to-test`) as a `baseline_failed` item; the controller checks that `baseline_commit` is that merge-base, and Gateway B lists the item:

```text
--evidence-json '{"check":"typecheck","result":"baseline_failed","command":"tsc --noEmit","exit_code":2,"proof":"467 errors, none in changed files","repository":"web","baseline_commit":"<merge-base sha>","baseline_exit_code":2,"baseline_proof":"the same 467 errors on the merge-base"}'
```

A passing or deferred fallback requires at least one actually executed passed command with `check`, `command`, `exit_code=0`, and `proof`; it is rejected when a driver exists, so it cannot silently bypass the project contract. `deferred_to_test` is Lean-only. It requires at least one structured deferred item, allows only `passed|deferred_to_test`, rejects duplicate checks, is cached for the exact fingerprint, and advances to test delivery without redispatching a Developer. A real compile/unit/lint failure is always `failed`; it cannot be relabeled as an environment limitation. Every deferred `check` must later be closed by exact structured passing test evidence. Hotfix uses `--passed` or `--failed` for direct evidence and never defers checks. Both driver and direct evidence must match the bound matrix: unique `Check` IDs, exact `command`, integer `exit_code` for command rows, nonempty `proof`, and coverage of every required check. Hotfix candidate paths must remain within the bound `intended_paths`. Every severity, including P3, then requires independent Review; line counts are not behavioral proof.

## Model dispatch preview

Before any role dispatch, follow `<plugin-root>/rules/model-discovery.md` and the shared `modelGateway` protocol: inspect cached choices, prepare a non-blocking preview, start immediately without waiting for a reply, and record the actual result. Apply real user corrections before start or to the next batch; never restart a running role merely to change models. This applies to the current runtime, including Claude-native single-step commands. Commands that do not dispatch roles need no model discovery.
