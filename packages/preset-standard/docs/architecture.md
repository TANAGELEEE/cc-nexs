# Architecture

## Layering
```text
packages/core/
  state-machine.mjs     纯状态路由
  progress-v2.mjs       revision + event + delivery attempts
  git-custodian.mjs     唯一 Git mutation 边界
  local-verify.mjs      Lean 本地 build/start/smoke driver
  base-release.mjs      Gateway B 后的 base 集成控制器
  test-release.mjs      test 集成与 release driver 控制器
  doctor.mjs            workspace/release 前置检查
  commands/*.md         跨 runtime 流程事实来源

packages/preset-standard/
  preset.yml            默认策略、角色和 browser provider
  commands/agents/      角色级执行契约
  templates/docs/       需求产物与人类文档

dist/preset-standard/   Claude/Codex 可安装物化产物
pi/                     Pi extension、skills、package agents
```
Claude Code, Codex, and Pi share the command documentation and the core controllers. Runtime adaptation only changes role dispatch and the browser provider; it does not change state, artifacts, or Git semantics.

## Authoritative State

`progress.json` v2 stores:

- `state`, `revision`, `events[]`;
- role counters;
- plan review bound to the plan hash, plan/release gates, local verification, and centralized Review fingerprint;
- repository worktree/candidate assignments;
- `delivery.strategy`;
- `delivery.test.policy/status/attempts[]`.

`progress.md` is a rendered mirror. Roles cannot edit either file directly; the Orchestrator appends events through a revision-aware helper.

New progress defaults to `mode=lean + auto_if_ready`.

## State Architecture

Lean default chain:
```text
INIT -> PLAN -> PLAN REVIEW -> Gateway A -> IMPLEMENT
-> LOCAL VERIFY -> one CONSOLIDATED REVIEW
-> TEST RELEASE -> TEST VERIFY -> Gateway B
-> BASE MERGE -> COMPLETE
```
Each repository uses `.worktrees/<id>-<slug>/<repo-id>` and `feature/<id>-<slug>`. Gateway A binds the requirements/plan scope and requires a plan review of that exact scope plus full acceptance-criteria traceability, while Gateway B binds the candidate fingerprint shared by local verification, centralized Review, and test acceptance.

Hotfix uses an independent `hotfix/<key>` branch and a latest-base worktree, directly maintaining the BUG file in the docs repo, without consuming a requirement number or publishing placeholder commits. State resides in the workspace `.cc-nexs/hotfixes/<key>/`, and the document is located via `progress.hotfix_document`; the legacy hotfix.md can still be restored. All levels require local verification, independent Review, precise test evidence, and Gateway B; P3 line counts serve only as a risk reference. Authorized-scope revisions use `revise-hotfix` to rebind in place while preserving history; contract extensions use `--promote-lean` to migrate alongside the BUG into Lean and return to Gateway A, preserving the original branch and key. Environment acceptance limitations after a real deployment may be handled through an explicitly authorized Gateway B exception, and must not be marked as test passed or authorized for production deployment by default.

## Git Custodian

Roles and the Orchestrator do not perform arbitrary Git mutations. The Git Custodian is responsible for:

- creating workspace worktrees;
- staging/committing candidates at the exact paths declared by roles;
- maintaining `refs/cc-nexs/candidates/<feature>/<repo>`;
- test integration;
- configured base merge/finalize after explicit user authorization.

Test integration does not modify the feature worktree:
```text
candidate ref -> source SHA
latest origin/test -> temp detached worktree
merge --no-ff -> non-force push -> fresh fetch -> ancestry proof
```
When a concurrent advance of the remote test branch causes a non-fast-forward, it stops and requires a retry; it does not force push. If the candidate is already in the remote ancestry, it returns an idempotent success.

## Release driver

The project provides this through private configuration:
```yaml
release:
  test:
    environment: test
    app_url: https://test.example.com
    operations_url: https://ops.example.com
    allowed_hosts: [test.example.com, ops.example.com]
    credential_ref: keychain://cc-nexs/test-console
    driver:
      command: node
      args: [.cc-nexs/release-driver.mjs]
      timeout_seconds: 1800
```
The controller sends one JSON request via stdin. The driver's stdout must contain only one JSON object:

Async CI/CD can return immediately on the first run:
```json
{"status":"pending","pipeline":{"id":"...","url":"..."}}
```
At this point the status is `deploying`. `release-test --resume` polls using `operation=release_test_status` and the existing pipeline evidence; it will not re-integrate or trigger the pipeline again. It returns only after deployment is complete:
```json
{
  "status": "succeeded",
  "pipeline": {"id": "...", "url": "..."},
  "deployment": {"id": "...", "environment": "test"},
  "environment_revision": {"api": "sha", "web": "sha"}
}
```
The other terminal states are `failed` or `deployed_needs_manual_verification`. `succeeded` and `deployed_needs_manual_verification` require a non-empty pipeline that cannot be rebound, an `environment=test` deployment, and an `environment_revision` that exactly matches every test integration commit; anything missing or inconsistent fails closed.

## Lean local verification driver

Project-private configuration may provide a local driver independent of CI; when no driver exists, the parent Orchestrator executes the commands approved by the Lean plan or the commands bound to the Hotfix scope, then registers strictly structured evidence. Lean supports `passed|failed|deferred_to_test`, while Hotfix supports only `passed|failed`, and neither requires adding a new project script first:
```yaml
workflow:
  local_verify:
    driver:
      command: node
      args: [.cc-nexs/local-verify.mjs]
      timeout_seconds: 1200
```
The controller sends `{operation, feature, source, repositories}` JSON over stdin; each repo entry includes the exact candidate SHA and its assigned worktree. The driver runs the build, unit/integration tests, local frontend and backend startup, and smoke/e2e according to the approved plan or the bound Hotfix scope matrix, and writes only a single JSON object to stdout:
```json
{"status":"passed","evidence":[{"check":"api-smoke","result":"passed","command":"./scripts/api-smoke.sh","exit_code":0,"proof":"smoke passed"}]}
```
The command in the example above is illustrative only; the actual command must match the frozen matrix. The driver and direct registration use the same evidence validation, covering all required Checks; a string list, or a PASS without execution evidence, is invalid.

Lean also allows `deferred_to_test`: every locally executable check must pass, at least one start/smoke/E2E check constrained by local infrastructure must supply `{check,result,reason,test_action}`, and the result of all evidence may only be `passed|deferred_to_test`, with no duplicate checks. A genuine compile/unit/lint failure cannot be deferred. The same fingerprint reuses that result, and each deferred check must be closed out in the final test evidence with the exact object `{check,result:"passed",proof}`; a free-text substring does not count. Hotfixes may not be deferred. The driver must own readiness, non-conflicting ports, and process cleanup on both the success and failure paths. Local validation shortens the feedback loop but cannot replace the immutable test release and test environment acceptance.

## Browser capability

Browser is only a verification tool after a successful test merge/CI deployment; it is not a prerequisite capability for the test release:

| Runtime | Capability |
|---|---|
| Claude Code | `chrome-devtools-mcp` |
| Codex | The currently logged-in in-app/Chrome session |
| Pi | Prefer ego lite (isolated task Space); when unavailable, use `@injaneity/pi-computer-use@0.4.3` (`headless: true`) |

URLs may come from the versioned project config or a private overlay. URLs in project memory/instructions may only be used to discover candidates; automated flows must first add the host to `allowed_hosts`. Account credentials must not come from memory, Markdown, Git, or ordinary config; prefer reusing an existing login, and when necessary pass only an opaque `credential_ref` to an external secret provider.

MFA, CAPTCHA, an expired login, an unavailable provider, a missing URL, or an unclear environment identity will be recorded as `manual_required` after deployment; a completed test delivery is preserved unchanged, and once the missing evidence is supplied, work can resume from the same attempt.

## Release attempt

Each attempt computes the fingerprint from the sorted `{repository: sourceSHA}`. Event order:
```text
delivery.test.started
delivery.test.repository_integrated (per repository)
delivery.test.deploying | succeeded | failed | deployed_needs_manual_verification
delivery.test.verification_passed | verification_blocked
```
Repeated calls with the same successful fingerprint reuse the previous attempt. For a failed fingerprint, a new attempt is created only with an explicit `--retry`. A fix that changes the candidate SHA naturally starts the next round.

## Failure Consistency

- Some repositories have already been merged: the attempt retains evidence for each repository, and retry idempotently fills the gaps.
- Driver failure/timeout/invalid JSON: the attempt is marked as failed and enters the release block.
- Deployed but browser verification cannot be completed: a dedicated state waits for manual handling, without falsely reporting success.
- Test verification failure: fix in the same feature worktree, re-verify locally, take one delta Review, then publish a new attempt and run regression after deployment.

## Runtime Materialization

`scripts/build.mjs`:

- Materialize core/preset into `dist/preset-*`;
- Generate a mirror skill for each Codex command; approval/release-test includes a deterministic CLI block;
- For Pi, generate restricted P2 command skills and provider-specific package agents; the ego Verifier gets only Bash/`ego-browser`, and the fallback Verifier gets only computer-use tools;
- Keep Claude commands as the single source of truth.

The Pi base installation only requires `pi-subagents`. At runtime, probe for ego lite first; if it is unavailable, use the fallback Verifier only when computer-use is installed and its effective configuration is set to `browser_use: true` and `headless: true`. Only when neither option is available does it fall back to manual, without blocking capabilities such as init/status/build.

## Security Boundaries

- The automated controller accepts only `environment=test` and non-production-like allowlisted hosts.
- Force push, production branches, and implicit main merges are prohibited.
- Plaintext `password/passwd/credentials/secret_value` configuration fields are prohibited.
- The browser may access only configured hosts.
- Role sub-sessions cannot mutate Git or progress.
- Gateway A/B are state-machine stops, not global tool blocks.

## Completion and Production

`COMPLETE` only proves the test environment and contract closure. Production merges, production deployments, remote branch deletion, and worktree cleanup are all follow-up operations that require explicit human authorization.
