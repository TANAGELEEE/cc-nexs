---
description: "Generic orchestrator. Develops across one or more sprints, then performs one test release and final acceptance unless explicitly opted out or prerequisites are unavailable."
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep, Skill, Task, mcp__chrome-devtools__*"
argument-hint: "[feature_id] [--sprint=N | --resume] [--no-auto-test-release]"
---

# /cc-nexs:run

> **Core rule**: after a stage completes, immediately enter the next stage. Stop only at Lean Gateway A/B, legacy spec/deploy gates, a release/verification block, a circuit breaker, or a genuine tool failure.

Use existing user authorization throughout the run. On a fork/resume, resolve the currently installed plugin root rather than replaying an absolute cache path from chat history; read its current run command and controllers. Compatible patch upgrades retain candidate/evidence bindings and do not require a new test release. Resolve routine implementation choices within approved scope without new confirmations. A material scope change uses the active gate; while awaiting missing input, continue independent authorized work. After compaction or mid-turn steering, retain completed work and re-read authoritative state before dispatching.

This file contains only the common controller. Mode-specific states, dispatches, parsing, gates, and release evidence live in one active rule file so a run does not load unrelated workflows.

## Orchestrator boundary

The Orchestrator only coordinates. It does not author business artifacts, implementation, specs, reviews, or test code, and it never performs subjective model-based verification or arbitrary Git commands. It may invoke deterministic controllers and, for the documented no-local-driver fallback, execute Lean plan-approved or Hotfix scope-bound commands and record their real structured results. It may invoke the narrow Git Custodian for candidate mutations.

Do not add human gates for line counts, commit counts, tooling hashes, or ordinary implementation estimates. Keep scope/security/ownership bindings and exact-candidate evidence authoritative; changed verification inputs invalidate the affected evidence, not the business scope automatically. Reuse passing worker evidence for unchanged inputs rather than repeating the same commands in the parent; retain independent Review and required integrated/test checks. Missing DTO/default/error/recovery contracts must be closed in planning, not deferred to arbitrary implementation batches. Do not refresh an approved candidate merely because remote base advanced; use release-base's integration checks.

When a single role reports completion:

1. Prove every returned path belongs to the progress.json-assigned worktree and role write contract.
2. For implementation/code-owning role output, ask Git Custodian to stage and commit the exact code candidate. For Lean/Hotfix Planner, Reviewer, and Verifier documentation-only output, validate the paths but leave them in the docs worktree until the single final docs candidate after `COMPLETE`.
3. If anything is missing, redispatch the owning role with the concrete contract delta. Never repair the artifact in the Orchestrator or commit an incomplete result.

Fast/Full implementation fanout is a group exception: a worker completion only records its returned paths/evidence in parent memory. Before each same-wave batch, the parent must open one deterministic `implementation-delta begin` token containing every Assignment in that batch; after every child joins, it must close that token with `implementation-delta end` before another batch starts. The controller snapshots every progress-assigned worktree through a temporary Git index/tree, rejects any net path outside the active Assignments and narrow Full-QA docs allowance (including changes in an inactive or ownership-removed repository), and never mutates the real index. A token is parent-only and is never passed to a child. Only after every delta barrier passes may the parent run aggregate repository checks and serialize exactly one candidate refresh per changed repository. Never let a fast sibling create a candidate while another sibling is still writing.

When `nextStep()` returns `parallel`, dispatch the complete listed batch before waiting and do not advance until its barrier completes. Claude/Codex spawn all native children before awaiting. Pi makes one `subagent({ tasks, concurrency, async: true, worktree: false, context: "fresh" })` call and then one `subagent_wait({ id })`; it never loops through foreground `subagent` calls. Never serialize an explicitly parallel dispatch.

## 1. Locate the feature and resolve mode

Find the workspace root containing `.cc-nexs/workspace.yml`, load it with `loadWorkspaceConfig()`, and run doctor. Invocation may start at the workspace root or any assigned repository worktree, but every dispatch uses the exact assignment stored in progress.json.

Resolve authoritative state with `resolveFeatureProgress()`, including new Hotfix `.cc-nexs/hotfixes/<key>/`, migrated Lean state beside the BUG, and legacy docs state. Set `REQ_DIR`, `PROGRESS_MD`, and `PROGRESS_JSON` from that state location. For new Hotfix, resolve the separate BUG document through `progress.hotfix_document` and the assigned docs worktree; never infer it from the machine-state directory. For ordinary features, locate `doc/<id>.*` in the assigned docs worktree. Never assume the docs repository is nested in a code repository. If progress.md exists without progress.json, stop and require `/cc-nexs:migrate-progress`; never reconstruct authoritative history implicitly.

Read `${REQ_DIR}progress.json.mode` first and require `${REQ_DIR}config.json.mode` to agree. Historical features with both values missing default to `fast`; an explicit unknown value or mismatch fails closed.

```bash
MODE=$(grep -oE '"mode"\s*:\s*"[^"]*"' "${REQ_DIR}config.json" 2>/dev/null \
  | head -1 | grep -oE '"[^"]*"$' | tr -d '"')
[ -z "$MODE" ] && MODE=fast
case "$MODE" in
  lean|full|fast|lite|hotfix) ;;
  *) echo "❌ unknown explicit mode '$MODE'"; exit 1 ;;
esac
[ "$MODE" = "lite" ] && MODE=fast
```

Compare config/progress using their raw stored values before this normalization. Legacy `lite` then uses Fast roles, state machine, active rule, and command validation consistently; it must never fall through to Full.

For each Hotfix child, pass `CC_NEXS_PROGRESS_FILE=<absolute authoritative progress.json>` and `BUG_FILE=<resolved absolute BUG document>`. The role guard uses that exact progress assignment to authorize the one BUG document; `CC_NEXS_REQ_DIR` alone must not make it guess a private-state `hotfix.md`. Keep the role environment tied to the current task across Claude Code, Codex, and Pi.

For Lean/Hotfix, require `config_version: 2` before dispatch. Otherwise stop and print:

```text
/cc-nexs:migrate-feature-config <id> --dry-run
/cc-nexs:migrate-feature-config <id>
```

For a legacy approved Lean plan without bound risk, derive risk only from an exact `plan_scope_sha256` match. Missing, stale, ambiguous, or unstructured risk gets a conservative `high` floor. To persist a derivable value without replacing approval, use `/cc-nexs:migrate-feature-config <id> --bind-plan-risk`.

### Mandatory active-rule load

After resolving mode, **Read exactly one** file relative to the active plugin root containing this command (never relative to the project worktree), and do not Read/Glob the other mode rules:

| resolved mode | active rule |
|---|---|
| `lean` | `rules/run-lean.md` |
| `hotfix` | `rules/run-hotfix.md` |
| `full` | `rules/run-full.md` |
| `fast` or legacy `lite` | `rules/run-fast.md` |

The selected rule is authoritative for mode-specific dispatch, state parsing, human gates, circuit behavior, and release evidence. Continue using this common controller for shared safety and persistence.

Fast/full runs perform best-effort `syncFeatureReadme({ reqDir: REQ_DIR })` catch-up now and after each transition. Lean/Hotfix have no README and skip it. `no_anchor` warns; `no_change` and `no_readme` do not block.

## 2. Load one coherent runtime snapshot

Use `loadConfig({ projectRoot: pwd })`. Resolve:

- `preset.modes[MODE].enabled`, falling back to `preset.roles.enabled`
- `preset.modes[MODE].state_machine` (`lean`, `hotfix`, `full`, or `fast`)
- mode threshold overrides on `preset.workflow.thresholds`
- mode/project G2 setting
- `i18n.locale`

Resolve each dispatched role from a fresh coherent snapshot:

```js
const planText = MODE === 'lean' && existsSync(join(REQ_DIR, 'plan.md'))
  ? readFileSync(join(REQ_DIR, 'plan.md'), 'utf8')
  : '';
if (MODE === 'lean' && progressV2.gates?.plan?.approved) {
  assertPlanApprovalCurrent(progressV2, REQ_DIR);
}
// Run at the workspace root. hostContext identifies the non-secret account,
// executor surface, active model and provider configuration revision.
const saved = modelGateway('inspect', { runtime, context: hostContext }, { cwd: workspaceRoot });
// Discover only missing executor catalogs; reuse saved.catalogs otherwise.
// tasks includes {role, difficulty, reason, proposal?}; omit proposals when
// reusing a successful combination, unless there is a justified change.
const prepared = modelGateway('prepare', {
  runtime, context: hostContext, preset, catalogs: missingCatalogs, tasks,
  options: { models: mergedModels, featureConfig, progress: progressV2, planText },
}, { cwd: workspaceRoot });
// Show prepared.preview/table only if prepared.showPreview; do not await approval.
// Apply actual user feedback already received before start.
const frozen = modelGateway('start', {
  runtime, context: hostContext, batchId: prepared.batch.id,
}, { cwd: workspaceRoot });
const roleRuntime = frozen.batch.rows.find((row) => row.role === role).selection;
```

Do not pre-merge `featureConfig.models.roles` into `mergedModels`. Automatic routing follows public/overlay/project defaults, then the explicit feature role override is applied last. Trusted plan/hotfix risk may raise but never lower severity. Lean high/critical and Hotfix P0/P1 Reviewer routing uses `escalated`; `models.routing.enabled: false` is the explicit opt-out.

Before dispatch, follow `rules/model-discovery.md` for every mode and role, not only Lean. Use the advisory `modelGateway` protocol above for single-step role commands as well. Reuse workspace-local catalog and successful combinations before discovery. The preview is not a new human approval state: absent feedback, start immediately; do not poll, sleep, or end the turn awaiting a response. Feedback received after start applies to the next batch. Model selection is operational metadata, not approval scope: a catalog refresh never invalidates completed Review, tests, or user approval. Overlay is optional and is not a required model registry; preserve its existing project, release, and explicit model restrictions.

Claude uses `model`/`effort`, Codex uses `model`/`reasoning_effort`, and Pi uses `model`/`thinking` plus ordered `fallback_models`. `inherit` keeps the active runtime model. Record risk tier/source/signals, plan binding status, `matched_rules`, feature profile override, effective profile/model/effort, and fallback chain in dispatch evidence; show the model table only on first use or selection change. Re-resolve policy at stage boundaries without re-querying an unchanged host catalog. Record each real role result through `modelGateway('result', ...)`: learn only `succeeded`, preserve catalog on `task-failed`, invalidate the affected executor catalog on `model-unavailable`. Never mark a proposal as successfully dispatched.

Every dispatch gets `CC_NEXS_REQ_DIR=<absolute-feature-doc-dir>/` and the repository-id → assigned-worktree map. Treat old `all-docs/doc/<id>` wording as logical notation, not topology.

For a Fast/Full implementation group, resolve all child runtimes from the same coherent snapshot before launching the first child. Freeze model/effort or thinking/fallbacks, Assignment, repository, worktree, and Allowed paths for the whole batch. Do not resolve one child, await it, then resolve the next; that recreates serial execution and permits half-batch model drift.

### Construct `workflow`

`readProgress(progress.md)` delegates to its sibling progress.json. Rebuild the object before each `nextStep()` call:

```js
const presetG2 = preset.modes?.[MODE]?.g2_enabled ?? preset.workflow?.g2_enabled ?? true;
const progress = readProgress(PROGRESS_MD);
let progressV2 = readProgressV2(PROGRESS_JSON);
const featureConfig = JSON.parse(readFileSync(join(REQ_DIR, 'config.json'), 'utf8'));
const normalizedTestRelease = progress.workflow?.test_release
  || { policy: 'manual', status: 'idle', attempt: 0 };
const releaseOptOut = ARGS.includes('--no-auto-test-release');
const configuredOverride = project.workflow?.test_release?.policy
  ?? overlay?.workflow?.test_release?.policy;
const persistedPolicy = resolveTestReleasePolicy({
  progress: progressV2,
  featureConfig,
  configured: mergedWorkflow?.test_release?.policy,
  configuredOverride,
});
const latestLocalAttempt = progressV2.local_verification?.attempts?.findLast((item) => (
  item.fingerprint === progressV2.local_verification?.candidate_fingerprint
));
const exactRecordedReview = ['passed', 'blocked'].includes(progressV2.review?.status)
  && progressV2.review?.candidate_fingerprint === progressV2.local_verification?.candidate_fingerprint
  && latestLocalAttempt?.fingerprint === progressV2.review?.candidate_fingerprint;
// Fast/Full only: after the spec-writing child returns, the parent materializes
// exactly the code repositories declared by the ownership table. This happens
// before plan validation/review/G1; role children never invoke the mutation.
if (['fast', 'lite', 'full'].includes(MODE)
  && existsSync(join(REQ_DIR, 'spec.md'))
  && progressV2.gates?.g1?.approved !== true
  && !['INIT', 'REQ_DRAFTED', 'RECON_DONE'].includes(progressV2.state)) {
  runCcNexsCommand(['sync-implementation-worktrees', FEATURE_ID], { cwd: WORKSPACE_ROOT });
  progressV2 = readProgressV2(PROGRESS_JSON);
}
// Fast/Full only: this deterministic controller also verifies the current G1
// binding. A legacy approved spec without binding returns an empty assignment
// set and therefore keeps the historical single-worker path.
const implementationPlan = ['fast', 'lite', 'full'].includes(MODE)
  && existsSync(join(REQ_DIR, 'spec.md'))
  && !['INIT', 'REQ_DRAFTED', 'RECON_DONE'].includes(progressV2.state)
  ? runCcNexsCommand(['validate-implementation-plan', FEATURE_ID], { cwd: WORKSPACE_ROOT })
  : { contractVersion: 0, assignments: [], legacy: true };
const workflow = {
  plan_approved: progressV2.gates?.plan?.approved === true,
  delivery_lane: progressV2.gates?.plan?.binding?.delivery_lane || 'standard',
  release_approved: progressV2.gates?.release?.approved === true,
  hotfix: progressV2.hotfix ? {
    ...progressV2.hotfix,
    delta_attempts: progressV2.review?.closure_attempts || 0,
  } : null,
  local_verification: {
    status: progressV2.local_verification?.status || 'idle',
    context: progressV2.local_verification?.context || null,
  },
  review: {
    status: progressV2.review?.status || 'idle',
    exact: exactRecordedReview,
    closure_attempts: progressV2.review?.closure_attempts || 0,
    gateway_b_delta_attempts: progressV2.review?.gateway_b_delta_attempts || 0,
  },
  g2_enabled: presetG2,
  g2_approved: progress.workflow.g2_approved,
  g2_approved_sprints: progress.workflow.g2_approved_sprints,
  sprint_delivery: progress.workflow?.sprint_delivery || 'per_sprint',
  test_release: {
    policy: releaseOptOut ? 'manual' : persistedPolicy,
    status: normalizedTestRelease.status,
    attempt: normalizedTestRelease.attempt || 0,
    prerequisites_met: true,
  },
  base_release: {
    status: progressV2.delivery?.base?.status || 'idle',
    attempt: progressV2.delivery?.base?.attempts?.length || 0,
  },
  implementation: {
    contract_version: implementationPlan.contractVersion,
    sprints: implementationPlan.sprints,
    sprint_total: implementationPlan.sprintTotal,
    assignments: implementationPlan.assignments,
    max_parallel: mergedWorkflow?.implementation_max_parallel || 4,
  },
};
```

New features default to `final_only + auto_if_ready`. An explicit project/overlay `manual` or `disabled` wins. A legacy progress file without `delivery` remains `per_sprint + manual`; an upgrade cannot silently grant remote-write authority. `--no-auto-test-release` affects only this invocation; `config.json.release.test=manual` persists the choice.

## 3. Compact dispatch loop

Repeat until terminal or stopped:

1. Re-read authoritative state/revision, config, active documents, role routing, counters, and workflow.
2. Call `nextStep({ state, counters, thresholds, enabledRoles, sprint, humanGateApproved, workflow, mode })`.
3. Apply the active mode rule to the returned `{ next, role, action, stop, parallel, fanout, circuitBreaker }`.
4. A circuit breaker appends its diagnostic event and required changelog. Dispatch a role only through the active rule's mapping. For `parallel`, launch calls together. For `fanout: implementation_repositories`, replace the generic implementation call with the active rule's validated dependency waves; flatten any listed QA call into the first wave. Immediately before each implementation batch, run `implementation-delta begin <id>` with one `--assignment` per batch member and retain its opaque token only in the parent. Launch every same-wave child before awaiting, join the complete batch, then run `implementation-delta end <id> --token <token>`. A missing/invalid token or out-of-scope delta blocks the fanout before another wave, aggregate verification, or candidate mutation. Individual fanout workers never trigger Git Custodian.
5. Parent control actions are deterministic:
   - after Fast/Full spec authoring and before spec validation/Review/G1 → `sync-implementation-worktrees`; it parses ownership against configured non-doc repositories, asks Git Custodian to create only missing assigned worktrees, persists them, and is a no-op when already synchronized. Never delegate it to Planner/Fullstack children and never run it after G1.
   - before/after each Fast/Full implementation batch → `implementation-delta begin|end`; begin accepts all same-Sprint/same-Wave Assignment IDs in that bounded batch, and end proves the real net worktree delta against the exact G1-bound Allowed paths. It monitors every progress-assigned code repository, including repositories removed from the current ownership table, as zero-delta unless active. It also monitors the docs worktree as zero-delta by default; only Full's first implementation+QA batch may add the fixed `--allow-doc-path test-cases.md --allow-doc-path qa-scripts/**` allowance, and that token is closed only after QA joins. It fails closed on HEAD/branch/worktree/G1 drift. Never pass the token to a role child or substitute a model path review for this controller.
   - `verify_local` → `/cc-nexs:verify-local`; an agent is never a substitute. Treat the controller status as control flow, not mere evidence: `passed` (and Lean-only `deferred_to_test`) keeps the state machine's intended success transition; `failed` replaces it with the active rule's local-failure state. Never blindly apply the pre-action `next` after a failed check.
   - `release_test` / `release_test_hotfix` → release safety preflight, then `/cc-nexs:release-test` with active-rule flags.
   - Before release approval, reconcile a late CI receipt through `release-test --resume` on the same attempt, then record actual verification. `approve-release` can reconcile a stale Lean/Hotfix test state only after exact-candidate test, local and Review evidence validate; it never invents a passing result. Representative sampling is allowed when the approved acceptance matrix binds implementation families and exclusions; do not expand it into all business flows or describe samples as exhaustive coverage. Environment unavailability uses the existing explicit exception gateway, not fabricated success.
   - `resolve_test_conflict` → dispatch the active Developer to the recorded conflict worktree; resolve and stage only conflicting paths, preserving candidate and test-only behavior. Run `/cc-nexs:resolve-test-conflict <id>`, then immediately `/cc-nexs:release-test <id> --resume` (Hotfix: add `--hotfix`). Re-read persisted state after each control; another repository may conflict in the same attempt. Do not start another attempt or request approval for a mechanically resolvable conflict. If product code must change, use the original assigned feature branch and create fresh local/Review evidence instead.
   - `poll_test_release` → `/cc-nexs:release-test <id> --resume` once; Hotfix also requires `--hotfix`. If still `deploying` or `awaiting_receipt`, retain the same attempt for the next resume; never retrigger deployment for missing receipts.
   - `configure_auto_test_release` → print the missing driver/policy fields and return. It never fabricates a release attempt.
   - `await_deploy_approval` → print the active Fast/Full G2 summary and return; it never authorizes production.
   - `release_base` → pre-transition to mode-specific `BASE_MERGING`, run `/cc-nexs:release-base`, then record `COMPLETE` only after successful integration and cleanup. A running MR remains BASE_MERGING and resumes the same release-base control; do not mark COMPLETE or block for a second approval. If the controller records `BASE_CHANGED` or `HOTFIX_BASE_CHANGED`, re-read state and immediately continue to `sync_base`; this is recoverable automation, not a human stop or an ordinary tool failure.
   - `sync_base` → run `/cc-nexs:sync-base <id>`; use the persisted result state as effectiveNext. A clean merge goes straight to local verification; do not restart implementation or planning. If it returns conflicts, dispatch the active Developer to resolve those files while preserving both the approved feature and upstream intent. The Developer edits files only; Custodian stages the resolved paths, verifies there are no unmerged entries, completes the merge commit, and updates the candidate ref. Preserve unrelated staged upstream merge changes; do not use ordinary `commitCandidate` while a merge is pending. Never resolve by wholesale ours/theirs or force push. Continue local verification, independent Review and test verification for the new candidate through the existing mode transitions. Only unresolved business ambiguity, changes outside authorized scope, permissions, or an existing circuit breaker require human input. Existing release gates remain authoritative; do not invent approval for a changed candidate.
   - `parse_*_conclusion` → parse only the active rule's file/pattern/outcomes.
   - `continue`, `continue_to_test`, and `noop` → no role/tool side effect; apply only the returned state movement.
   - `unknown_state` or `unknown_phase` → stop as a genuine controller failure and report the exact mode/state; never guess a transition.
6. Let the completed action determine `effectiveNext` (normally the returned `next`; `verify_local` failure uses the active rule's explicit failure state). Re-read authoritative progress, then persist `effectiveNext` **before** honoring `stop: true`. If the current state is still the captured `state` and `effectiveNext !== state`, call `transitionState(PROGRESS_MD, { from: state, to: effectiveNext, reason })` exactly once—even when the action persisted evidence and incremented revision. This covers boundaries such as `TEST_VERIFIED -> RELEASE_PENDING_HUMAN` and `TEST_RELEASE -> *_BLOCKED|*_DEPLOYED_NEEDS_MANUAL_VERIFY`; returning first would strand progress in the prior state. If a controller already changed state to `effectiveNext`, do not append a synthetic transition. Any third state is stale/conflicting: discard the decision, rebuild the snapshot, and call `nextStep()` again.
7. Exact candidate fingerprint, attempt, evidence, and from-state checks make reruns idempotent. Never redispatch a completed role, re-integrate a candidate, retrigger CI, or append a transition already reflected in authoritative state. Release actions that only update delivery status must be re-read and routed by `nextStep()`; they never receive an invented same-state transition.
8. Only after step 6/7, if `stop: true`, render the active rule's summary from the newly persisted state and return. Otherwise Fast/Full sync README best-effort and the loop continues immediately.

A stop returns orchestration control; it is not a tool lock. The user-authorized parent session may still inspect status, prepare documents or deployment, and use Git/SQL/SSH as separately authorized.

Release attempts are immutable. Invoke `/cc-nexs:release-test` once per candidate fingerprint; `pending` is resumed without another integration or trigger, and only a deliberate failed-attempt retry uses `--retry`. A verification-only limitation never rolls back a successful test merge/deployment.

### Shared release safety boundary

Before test integration, `/cc-nexs:doctor --release-test --feature <id>` checks only delivery safety: a non-production test environment, release driver, exact candidates, and at least one approved deploy repository with `test_branch`. Feature scoping keeps a stale unrelated task from blocking this candidate while workspace/global safety remains checked. Reject plaintext credentials and production-like hosts. Missing URL, browser/login, bucket/CORS/IAM observability, or other verification capability is post-deploy work and must not block integration.

After CI/CD succeeds, freeze one runtime browser provider: Claude Code uses `chrome-devtools-mcp`; Codex uses the current in-app/Chrome signed-in session; Pi prefers a successful ego lite probe and otherwise uses the dedicated headless `@injaneity/pi-computer-use@0.4.3` Verifier with `browser_use: true` and `headless: true`. Never expose two providers to one child. Enforce `release.test.allowed_hosts`, prove test-environment identity, and reuse existing authentication. Never read plaintext credentials from memory, Markdown, Git, config, or prompts; only an opaque external `credential_ref` may be resolved. If verification capability is unavailable, persist `manual_required` on the same deployed attempt so it can resume later. Only explicit user authorization may use the existing `approve-release --test-exception` gateway with exact-candidate passed local/Review evidence, actual deployment, environment evidence, and rollback proof. Preserve the unverified test fact and limit authorization to configured base integration; product failures cannot use an environment exception.

### Compact command index

This index keeps cross-runtime command discovery stable; dispatch details belong only to the active rule.

| mode | representative role commands |
|---|---|
| Full | `/cc-nexs:recon`; `/cc-nexs:planner`; `/cc-nexs:dev <id> --mode=feat --sprint=N`; `/cc-nexs:qa cases`; `/cc-nexs:evaluator` |
| Fast/Lite | `/cc-nexs:fullstack <id> --phase=spec`; `/cc-nexs:review accept <id>`; `/cc-nexs:verify regression <id>` |
| Lean | `/cc-nexs:plan <id>`; `/cc-nexs:execute <id>`; `/cc-nexs:lean-review <id>`; `/cc-nexs:verify-local <id>`; `/cc-nexs:approve-release <id>`; `/cc-nexs:request-release-changes <id>` |
| Hotfix | `/cc-nexs:hotfix`; `/cc-nexs:revise-hotfix`; dedicated developer/reviewer/verifier agents; `/cc-nexs:release-test <id> --hotfix`; `/cc-nexs:approve-release <id>` |

The **Role → command dispatch table**, mode conclusion tables, and gate summaries are in the selected rule. Stable state markers include `PLAN_PENDING_HUMAN`, `CONSOLIDATED_REVIEW`, `RELEASE_PENDING_HUMAN`, `GATEWAY_B_CHANGE_REQUESTED`, `SCOPE_CHANGE_REQUESTED`, `HOTFIX_RELEASE_PENDING_HUMAN`, `SPEC_PENDING_HUMAN`, `DEPLOY_GATE`, `ALL_SPRINTS_DEV_DONE`, `INTEGRATION_REVIEW`, `TEST_RELEASE`, `FINAL_QA_BLOCKED`, and `BASE_MERGING`. The fast rule owns **fast 模式解析**. The full rule owns the **Artifact completeness gate** over `deploy.md api-doc.md test-report.md`. Lean keeps: **完整 Review 只有一次；修复只允许一次 delta closure**.

## 4. Common completion and candidate discipline

After implementation is authorized, the default delivery endpoint is **ready for base merge**, not code complete, deployed, a partial test report, or an unpersisted state. Continue local checks, independent Review, test deployment, agreed acceptance, and evidence reconciliation automatically. When the user already authorized merge, invoke the approval controller once prerequisites hold and continue through remote merge proof; do not ask for the same authorization again. Exact-candidate exceptions do not automatically transfer to a changed candidate.

An unfinished check is work to dispatch, not `manual_required`. Before stopping for missing test conditions, try available authorized verification routes and continue independent checks. The verification controller requires a structured `human_input_required` evidence item with `check`, `reason`, `attempted`, `required_input`, and `resume_action`. State exactly which account permission, login action, test data, external capability, or risk decision the user must supply. Ask that concrete question in the same response; never stop with only “conditions not met” or ask for a blanket exception instead of running available checks. Do not solicit plaintext credentials. A genuine product failure follows repair/reverification, not an environment exception.

A suspected pre-existing or unrelated defect is not automatically a failure of this feature, nor proof it is safe to ignore. Compare the same failure on a recorded baseline and the candidate, inspect the affected call chain, and obtain independent Review. Continue unaffected checks and try another already-approved representative page/dataset that covers the same contract. Do not expand scope to fix unrelated business bugs, weaken assertions, or call an unexecuted check passed. If an equivalent check succeeds, retain the background defect as a separately tracked limitation. If the required check remains impossible, ask for usable conditions or explicit acceptance of that specific gap; generic merge authorization is not exception authorization.

Record such a blocker through `record-test-verification --manual-required --evidence-json` with `type: "human_input_required"`, `cause: "pre_existing_defect"`, the standard blocker fields, and `baseline_commit`, `baseline_proof`, `candidate_proof`, `impact`, `alternative_attempted`, `tracking`, `review_proof`. The controller rejects incomplete attribution. The existing exact-candidate deployment/local/Review and explicit exception requirements still apply. Unknown attribution or a candidate-introduced regression cannot be classified as pre-existing. A previously recorded product failure is not silently rewritten: retain it and investigate rather than using this classification to evade it.

When a tool returns pending CI/MR, keep the same attempt and poll with backoff while the host can continue; pending is not a human approval gate. If the host cannot keep running, report the exact pending attempt and resume action rather than claiming completion or missing user approval. Never repeatedly redeploy or busy-poll. Preserve configured circuit breakers and genuine scope/security approvals.


Loop termination is limited to:

- `COMPLETE`
- a state-machine `stop: true` human/manual/release/verification gate or circuit breaker
- a genuine tool failure after bounded self-repair

No other condition waits for user input.

At `COMPLETE`, fast/full performs a final README sync; Lean/Hotfix prints the active rule's evidence and cleanup summary. Mention `/cc-nexs:compound <id>` only when this task revealed a concrete, reusable lesson or the user requested it.

The docs repository follows the same path-safety and candidate-ref discipline as code repositories. Fast/Full may create or update its docs candidate commit after each document-writing phase and again at `COMPLETE`. Lean/Hotfix are explicitly final-only: plan, Review, and verification keep their documents in the assigned docs worktree, and Git Custodian creates exactly one final docs candidate commit only after the code base release is proven and state is `COMPLETE`. An intermediate Lean/Hotfix docs candidate can invalidate exact-candidate evidence and is forbidden. Stage only the configured feature directory for ordinary/legacy tasks. For new Hotfix, stage only the assigned BUG document and keep machine state under `.cc-nexs/hotfixes/<key>/`; a promoted Lean task uses its BUG-adjacent `<BUGstem>.lean/` artifacts. Prepare candidate metadata before committing so the ref—not a self-referential SHA in progress.json—remains authoritative. The docs repository integrates last.

`COMPLETE` does not authorize remote publishing, merge, or deletion. Only an explicit user release instruction may invoke Git Custodian `prepare`/merge/finalize. Finalize freshly fetches the remote base, proves both tips are contained, requires clean worktrees, and then removes feature worktree/ref/branches unless the user explicitly asks for `--keep-remote`.
