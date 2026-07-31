// cc-nexs core: state machine.
// Pure logic: given a state + counters + role-list, decide next state and the role/action to invoke.
// Side-effects (calling reviewer, writing progress) live in the orchestrator command, not here.

const TERMINAL = new Set(['COMPLETE']);
const HUMAN_GATE = 'SPEC_PENDING_HUMAN';

function isFullReviewRevisionState(state) {
  return state === 'SPEC_NEEDS_REVISION'
    || state === 'INTEGRATION_REVIEW_NEEDS_REVISION'
    || state === 'FINAL_FIX_REVIEW_NEEDS_REVISION'
    || /^SPRINT_\d+_(?:SA_TEST_REVIEW_NEEDS_REVISION|FIX)$/.test(state);
}

function isFullFixRetryState(state) {
  return state === 'FINAL_QA_BLOCKED' || /^SPRINT_\d+_FIX$/.test(state);
}

function isFastReviewRevisionState(state) {
  return state === 'SPEC_NEEDS_REVISION'
    || state === 'CODE_REVIEW_NEEDS_REVISION'
    || state === 'FIX_REVIEW_NEEDS_REVISION';
}

/**
 * Build a state graph specialized to a preset's enabled roles.
 * Roles act as "stations"; the SOP backbone is fixed but stations may be skipped if the
 * corresponding role is not enabled.
 *
 * Three state-machine flavors are supported via the `mode` parameter:
 *
 *   mode='full' — five-role SOP with sprint slicing, plus pre-spec recon:
 *     INIT → REQ_DRAFTED → RECON_DONE → SPEC_DRAFTED → SPEC_REVIEWING → [SPEC_PENDING_HUMAN] → SPEC_APPROVED
 *       → SPRINT_<N>_DEV → SPRINT_<N>_DOC_SYNC → SPRINT_<N>_SA_CODE → SPRINT_<N>_DEV_DONE
 *       → … → ALL_SPRINTS_DEV_DONE → INTEGRATION_REVIEW → TEST_RELEASE
 *       → FINAL_QA → [FINAL_FIX → FINAL_FIX_REVIEW → TEST_RELEASE] → FINAL_EVAL → COMPLETE
 *     RECON stage: repo-scout reads src/ and produces repo-context.md so Planner — which is
 *     forbidden from reading src/ — can ground its spec in the existing infrastructure.
 *     If the `repo-scout` role is not enabled in the active preset, RECON_DONE is skipped
 *     (REQ_DRAFTED jumps straight to SPEC_DRAFTED) — backward-compatible.
 *
 *   mode='fast' — three-role single-sprint merged pipeline:
 *     INIT → REQ_DRAFTED → SPEC_DRAFTED → SPEC_REVIEWING → [SPEC_PENDING_HUMAN] → SPEC_APPROVED
 *       → BUILD → TEST → [FIX → REGRESSION]* → ACCEPT → COMPLETE
 *     Roles: fullstack (replaces planner+tech-lead), reviewer (replaces sa+evaluator),
 *     verifier (replaces qa cases+run+regression).
 *
 *   mode='lean' — plan-first, two-gate, one-consolidated-review pipeline:
 *     INIT → PLANNING → PLAN_PENDING_HUMAN → PLAN_APPROVED → IMPLEMENTING
 *       → LOCAL_VERIFYING → CONSOLIDATED_REVIEW → CANDIDATE_READY
 *       → TEST_RELEASE → TEST_VERIFYING → RELEASE_PENDING_HUMAN
 *       → BASE_MERGING → COMPLETE
 *     Consolidated blockers take one bounded fix + delta-review closure. Gateway B
 *     implementation feedback takes one bounded local reverify + delta Review and
 *     a new test attempt; scope feedback invalidates Gateway A and returns to planning.
 *
 *   mode='hotfix' — standalone mini-Lean pipeline on its own latest-base worktree:
 *     INIT → HOTFIX_IMPLEMENTING → HOTFIX_LOCAL_VERIFYING
 *       → [HOTFIX_REVIEWING → HOTFIX_FIXING → HOTFIX_LOCAL_REVERIFYING → HOTFIX_DELTA_REVIEW]
 *       → HOTFIX_CANDIDATE_READY → HOTFIX_TEST_RELEASE → HOTFIX_TEST_VERIFYING
 *       → HOTFIX_RELEASE_PENDING_HUMAN → HOTFIX_BASE_MERGING → COMPLETE
 *     P3 skips the model Review only after its one-file/20-line/non-behavioral boundary is proven.
 *
 * Role mapping (role identifier in preset → state slot):
 *   repo-scout                   → recon: produce repo-context.md (full only, optional)
 *   planner | pm                 → drafts spec       (full)
 *   tech-lead | developer | dev  → implements code   (full)
 *   sa | reviewer                → reviews spec / cases / code
 *   qa | verifier                → writes cases, runs tests, regression
 *   evaluator                    → contract-driven acceptance scoring (full only)
 *   fullstack                    → spec + code + fix (fast only; bakes recon into --phase=spec)
 *
 * If `qa` is missing, tests are folded into reviewer responsibilities.
 * If `evaluator` is missing, the final acceptance step is folded into reviewer.
 */
export function nextStep({
  state,
  counters = {},
  thresholds = { review_revision: 3, fix_per_bug: 3, evaluator_reject: 2 },
  enabledRoles,
  sprint = { current: 0, total: 0 },
  humanGateApproved = false,
  workflow = {},
  mode = 'fast',
}) {
  if (mode === 'lean') {
    return nextStepLean({ state, counters, thresholds, enabledRoles, humanGateApproved, workflow });
  }
  if (mode === 'hotfix') {
    return nextStepHotfix({ state, counters, thresholds, enabledRoles, workflow });
  }
  if (mode === 'fast') {
    return nextStepFast({ state, counters, thresholds, enabledRoles, humanGateApproved, workflow });
  }
  return nextStepFull({ state, counters, thresholds, enabledRoles, sprint, humanGateApproved, workflow });
}

function nextStepHotfix({ state, counters, thresholds, enabledRoles, workflow = {} }) {
  const has = (role) => enabledRoles.includes(role);
  const developer = has('hotfix-developer') ? 'hotfix-developer' : has('lean-developer') ? 'lean-developer' : has('fullstack') ? 'fullstack' : null;
  const reviewer = has('hotfix-reviewer') ? 'hotfix-reviewer' : has('lean-reviewer') ? 'lean-reviewer' : has('reviewer') ? 'reviewer' : null;
  const verifier = has('hotfix-verifier') ? 'hotfix-verifier' : has('lean-verifier') ? 'lean-verifier' : has('verifier') ? 'verifier' : reviewer;
  const severity = workflow.hotfix?.severity || workflow.hotfix_severity || null;
  const releaseApproved = workflow.release_approved === true;
  const deltaAttempts = Number(workflow.hotfix?.delta_attempts || 0);
  const testFailures = Number(counters.fix_per_bug?.HOTFIX_TEST || 0);

  if (TERMINAL.has(state)) return { next: state, role: null, action: 'noop' };
  if (['HOTFIX_REVIEW_BLOCKED', 'HOTFIX_TEST_FAILED', 'HOTFIX_CHANGE_REQUESTED'].includes(state) && deltaAttempts >= 1) {
    return { next: 'HUMAN_INTERVENTION', role: null, action: 'await_human', circuitBreaker: 'hotfix_delta', stop: true };
  }
  if (state === 'HOTFIX_TEST_FAILED' && testFailures > thresholds.fix_per_bug) {
    return { next: 'HUMAN_INTERVENTION', role: null, action: 'await_human', circuitBreaker: 'hotfix_fix', bug: 'HOTFIX_TEST', stop: true };
  }
  switch (state) {
    case 'INIT':
      return { next: state, role: null, action: 'bind_hotfix_scope', stop: true };
    case 'HOTFIX_IMPLEMENTING':
      return { next: 'HOTFIX_IMPLEMENTED', role: developer, action: 'implement_hotfix' };
    case 'HOTFIX_IMPLEMENTED':
      return { next: 'HOTFIX_LOCAL_VERIFYING', role: null, action: 'verify_local' };
    case 'HOTFIX_LOCAL_VERIFY_FAILED':
      return { next: 'HOTFIX_IMPLEMENTED', role: developer, action: 'fix_local' };
    case 'HOTFIX_LOCAL_VERIFYING':
      if (severity === 'P3') return { next: 'HOTFIX_CANDIDATE_READY', role: null, action: 'assert_p3_candidate' };
      return { next: 'HOTFIX_REVIEWING', role: reviewer, action: 'review_hotfix' };
    case 'HOTFIX_REVIEWING':
      return { next: 'PARSE_HOTFIX_REVIEW', role: null, action: 'parse_review_conclusion' };
    case 'HOTFIX_REVIEW_BLOCKED':
    case 'HOTFIX_TEST_FAILED':
    case 'HOTFIX_CHANGE_REQUESTED':
      return { next: 'HOTFIX_FIXING', role: developer, action: 'fix_hotfix' };
    case 'HOTFIX_FIXING':
      return { next: 'HOTFIX_LOCAL_REVERIFYING', role: null, action: 'verify_local' };
    case 'HOTFIX_LOCAL_REVERIFY_FAILED':
      return { next: 'HOTFIX_FIXING', role: developer, action: 'fix_local' };
    case 'HOTFIX_LOCAL_REVERIFYING':
      if (severity === 'P3') return { next: 'HOTFIX_CANDIDATE_READY', role: null, action: 'assert_p3_candidate' };
      return { next: 'HOTFIX_DELTA_REVIEW', role: reviewer, action: 'review_hotfix_delta' };
    case 'HOTFIX_DELTA_REVIEW':
      return { next: 'PARSE_HOTFIX_DELTA_REVIEW', role: null, action: 'parse_review_conclusion' };
    case 'HOTFIX_DELTA_REVIEW_BLOCKED':
    case 'HOTFIX_P3_BOUNDARY_BLOCKED':
    case 'HUMAN_INTERVENTION':
      return {
        next: 'HUMAN_INTERVENTION', role: null, action: 'await_human',
        circuitBreaker: state === 'HOTFIX_P3_BOUNDARY_BLOCKED' ? 'hotfix_boundary' : 'hotfix_delta', stop: true,
      };
    case 'HOTFIX_CANDIDATE_READY':
      return { next: 'HOTFIX_TEST_RELEASE', role: null, action: 'continue' };
    case 'HOTFIX_TEST_RELEASE':
      return nextHotfixTestReleaseStep({ workflow, verifier });
    case 'HOTFIX_TEST_RELEASE_BLOCKED':
    case 'HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY':
      return { next: state, role: null, action: 'await_human', stop: true };
    case 'HOTFIX_TEST_VERIFYING':
      return { next: 'PARSE_HOTFIX_TEST', role: null, action: 'parse_test_conclusion' };
    case 'HOTFIX_TEST_VERIFIED':
      return { next: 'HOTFIX_RELEASE_PENDING_HUMAN', role: null, action: 'await_release_approval', stop: true };
    case 'HOTFIX_RELEASE_PENDING_HUMAN':
      if (releaseApproved) return { next: 'HOTFIX_BASE_MERGING', role: null, action: 'release_base' };
      return { next: state, role: null, action: 'await_release_approval', stop: true };
    case 'HOTFIX_BASE_MERGING':
      return { next: 'COMPLETE', role: null, action: 'complete' };
    case 'HOTFIX_BASE_CHANGED':
      return { next: 'HOTFIX_FIXING', role: developer, action: 'sync_base' };
    case 'HOTFIX_BASE_MERGE_BLOCKED':
      return { next: state, role: null, action: 'await_human', stop: true };
    default:
      return { next: state, role: null, action: 'unknown_state' };
  }
}

function nextHotfixTestReleaseStep({ workflow, verifier }) {
  const release = workflow.test_release || {};
  const policy = release.policy || 'manual';
  const status = release.status || 'idle';
  const attempt = Number(release.attempt || 0);
  if (status === 'succeeded' || status === 'verified') {
    return { next: 'HOTFIX_TEST_VERIFYING', role: verifier, action: attempt > 1 ? 'verify_hotfix_regression' : 'verify_hotfix_test' };
  }
  if (status === 'failed') return { next: 'HOTFIX_TEST_RELEASE_BLOCKED', role: null, action: 'await_human', stop: true };
  if (status === 'deployed_needs_manual_verification') {
    return { next: 'HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY', role: null, action: 'await_human', stop: true };
  }
  if (policy === 'manual' || release.prerequisites_met === false) {
    return { next: 'HOTFIX_TEST_RELEASE', role: null, action: 'await_deploy_approval', stop: true };
  }
  return { next: 'HOTFIX_TEST_RELEASE', role: null, action: 'release_test_hotfix' };
}

function nextStepLean({ state, counters, thresholds, enabledRoles, humanGateApproved, workflow = {} }) {
  const has = (role) => enabledRoles.includes(role);
  const planner = has('lean-planner') ? 'lean-planner' : has('planner') ? 'planner' : null;
  const developer = has('lean-developer') ? 'lean-developer' : has('developer') ? 'developer' : has('fullstack') ? 'fullstack' : null;
  const reviewer = has('lean-reviewer') ? 'lean-reviewer' : has('reviewer') ? 'reviewer' : null;
  const verifier = has('lean-verifier') ? 'lean-verifier' : has('verifier') ? 'verifier' : reviewer;
  const planApproved = workflow.plan_approved ?? humanGateApproved;
  const releaseApproved = workflow.release_approved === true;

  if (TERMINAL.has(state)) return { next: state, role: null, action: 'noop' };
  if (state === 'REVIEW_CLOSURE_BLOCKED') {
    return { next: 'HUMAN_INTERVENTION', role: null, action: 'await_human', circuitBreaker: 'review', stop: true };
  }
  if (state === 'TEST_VERIFY_FAILED') {
    for (const [bug, attempts] of Object.entries(counters.fix_per_bug || {})) {
      if (attempts >= thresholds.fix_per_bug) {
        return { next: 'HUMAN_INTERVENTION', role: null, action: 'await_human', circuitBreaker: 'fix', bug, stop: true };
      }
    }
  }

  switch (state) {
    case 'INIT':
      return { next: 'PLANNING', role: planner, action: 'draft_plan' };
    case 'PLANNING':
      return { next: 'PLAN_PENDING_HUMAN', role: null, action: 'await_plan_approval', stop: true };
    case 'PLAN_PENDING_HUMAN':
      if (planApproved) return { next: 'PLAN_APPROVED', role: null, action: 'continue' };
      return { next: state, role: null, action: 'await_plan_approval', stop: true };
    case 'PLAN_APPROVED':
      return { next: 'IMPLEMENTING', role: developer, action: 'execute_plan' };
    case 'SCOPE_CHANGE_REQUESTED':
      return { next: 'PLANNING', role: planner, action: 'revise_plan_for_gateway_b' };
    case 'IMPLEMENTING':
      return { next: 'LOCAL_VERIFYING', role: null, action: 'verify_local' };
    case 'LOCAL_VERIFY_FAILED':
      return { next: 'IMPLEMENTING', role: developer, action: 'fix_local' };
    case 'LOCAL_VERIFYING':
      return { next: 'CONSOLIDATED_REVIEW', role: reviewer, action: 'review_candidate' };
    case 'CONSOLIDATED_REVIEW':
      return { next: 'PARSE_CONSOLIDATED_REVIEW', role: null, action: 'parse_review_conclusion' };
    case 'CONSOLIDATED_REVIEW_BLOCKED':
      return { next: 'REVIEW_FIXING', role: developer, action: 'fix_review' };
    case 'REVIEW_FIXING':
    case 'TEST_FIXING':
      return { next: 'LOCAL_REVERIFYING', role: null, action: 'verify_local' };
    case 'LOCAL_REVERIFY_FAILED':
      if (workflow.local_verification?.context === 'test') {
        return { next: 'TEST_FIXING', role: developer, action: 'fix_local' };
      }
      if (workflow.local_verification?.context === 'gateway_b') {
        return { next: 'GATEWAY_B_FIXING', role: developer, action: 'fix_local' };
      }
      return { next: 'REVIEW_FIXING', role: developer, action: 'fix_local' };
    case 'LOCAL_REVERIFYING':
      return { next: 'REVIEW_CLOSURE', role: reviewer, action: 'review_delta' };
    case 'REVIEW_CLOSURE':
      return { next: 'PARSE_REVIEW_CLOSURE', role: null, action: 'parse_review_conclusion' };
    case 'CANDIDATE_READY':
    case 'TEST_RELEASE':
      return nextTestReleaseStep({
        workflow,
        verifier,
        initial: { next: 'TEST_VERIFYING', action: 'verify_test' },
        regression: { next: 'TEST_VERIFYING', action: 'verify_test_regression' },
      });
    case 'TEST_RELEASE_BLOCKED':
    case 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY':
      return { next: state, role: null, action: 'await_human', stop: true };
    case 'TEST_VERIFYING':
      return { next: 'PARSE_TEST_VERIFY', role: null, action: 'parse_test_conclusion' };
    case 'TEST_VERIFY_FAILED':
      return { next: 'TEST_FIXING', role: developer, action: 'fix_test' };
    case 'TEST_VERIFIED':
      return { next: 'RELEASE_PENDING_HUMAN', role: null, action: 'await_release_approval', stop: true };
    case 'RELEASE_PENDING_HUMAN':
      if (releaseApproved) return { next: 'BASE_MERGING', role: null, action: 'release_base' };
      return { next: state, role: null, action: 'await_release_approval', stop: true };
    case 'GATEWAY_B_CHANGE_REQUESTED':
      return { next: 'GATEWAY_B_FIXING', role: developer, action: 'fix_gateway_b_feedback' };
    case 'GATEWAY_B_FIXING':
      return { next: 'GATEWAY_B_LOCAL_REVERIFYING', role: null, action: 'verify_local' };
    case 'GATEWAY_B_LOCAL_REVERIFYING':
      return { next: 'GATEWAY_B_DELTA_REVIEW', role: reviewer, action: 'review_gateway_b_delta' };
    case 'GATEWAY_B_DELTA_REVIEW':
      return { next: 'PARSE_GATEWAY_B_DELTA_REVIEW', role: null, action: 'parse_review_conclusion' };
    case 'GATEWAY_B_DELTA_REVIEW_BLOCKED':
      return { next: 'HUMAN_INTERVENTION', role: null, action: 'await_human', circuitBreaker: 'gateway_b_review', stop: true };
    case 'BASE_MERGING':
      return { next: 'COMPLETE', role: null, action: 'complete' };
    case 'BASE_CHANGED':
      return { next: 'IMPLEMENTING', role: developer, action: 'sync_base' };
    case 'BASE_MERGE_BLOCKED':
    case 'HUMAN_INTERVENTION':
      return { next: state, role: null, action: 'await_human', stop: true };
    default:
      return { next: state, role: null, action: 'unknown_state' };
  }
}

function nextStepFull({
  state,
  counters,
  thresholds,
  enabledRoles,
  sprint,
  humanGateApproved,
  workflow,
}) {
  const has = (r) => enabledRoles.includes(r);
  const scout = has('repo-scout') ? 'repo-scout' : null;
  const planner = has('planner') ? 'planner' : has('pm') ? 'pm' : null;
  const dev = has('tech-lead') ? 'tech-lead' : has('developer') ? 'developer' : has('dev') ? 'dev' : null;
  const reviewer = has('sa') ? 'sa' : has('reviewer') ? 'reviewer' : null;
  const qa = has('qa') ? 'qa' : reviewer;
  const evaluator = has('evaluator') ? 'evaluator' : reviewer;
  const sprintDelivery = workflow.sprint_delivery || 'per_sprint';

  if (TERMINAL.has(state)) {
    return { next: state, role: null, action: 'noop' };
  }

  // Circuit breakers ----------------------------------------------------------
  // Counters are consecutive failures for their own loop. A stale/high counter
  // must never hijack unrelated delivery or terminal states.
  if (isFullReviewRevisionState(state) && counters.review_revision >= thresholds.review_revision) {
    return { next: 'SPEC_REVIEWING', role: planner, action: 'revise_spec', circuitBreaker: 'review' };
  }
  if (state === 'FINAL_ACCEPTANCE_REJECTED' && counters.evaluator_reject >= thresholds.evaluator_reject) {
    return { next: 'SPEC_REVIEWING', role: planner, action: 'revise_spec', circuitBreaker: 'evaluator' };
  }
  if (isFullFixRetryState(state)) {
    for (const [bug, n] of Object.entries(counters.fix_per_bug || {})) {
      if (n >= thresholds.fix_per_bug) {
        return { next: 'TECH_LEAD_REVIEW', role: dev, action: 'reevaluate_implementation', circuitBreaker: 'fix', bug };
      }
    }
  }

  // Backbone dispatch ---------------------------------------------------------
  switch (state) {
    case 'INIT':
      return { next: 'REQ_DRAFTED', role: null, action: 'await_requirements_md' };
    case 'REQ_DRAFTED':
      // Optional pre-spec recon: produce repo-context.md so Planner can ground in existing infra.
      // When repo-scout role is not enabled, skip RECON_DONE entirely for backward compatibility.
      if (scout) {
        return { next: 'RECON_DONE', role: scout, action: 'recon' };
      }
      return { next: 'SPEC_DRAFTED', role: planner, action: 'draft_spec' };
    case 'RECON_DONE':
      return { next: 'SPEC_DRAFTED', role: planner, action: 'draft_spec' };
    case 'SPEC_DRAFTED':
      return { next: 'SPEC_REVIEWING', role: reviewer, action: 'review_spec' };
    case 'SPEC_REVIEWING':
      return { next: 'PARSE_SPEC_REVIEW', role: null, action: 'parse_review_conclusion' };
    case 'SPEC_NEEDS_REVISION':
      // Revisions reuse the existing repo-context.md; do NOT re-run recon by default.
      // If SA review explicitly cites stale recon, the orchestrator can manually reset to REQ_DRAFTED.
      return { next: 'SPEC_DRAFTED', role: planner, action: 'revise_spec' };
    case HUMAN_GATE:
      if (humanGateApproved) return { next: 'SPEC_APPROVED', role: null, action: 'continue' };
      return { next: HUMAN_GATE, role: null, action: 'await_human_approval', stop: true };
    case 'SPEC_APPROVED':
      return { next: `SPRINT_${sprint.current || 1}_KICKOFF`, role: null, action: 'kickoff_sprint' };

    default:
      // Sprint states
      const m = state.match(/^SPRINT_(\d+)_(\w+)$/);
      if (m) {
        const N = parseInt(m[1], 10);
        const phase = m[2];
        switch (phase) {
          case 'KICKOFF':
            // Parallel: QA writes cases + Dev implements
            return { next: `SPRINT_${N}_DEV`, role: dev, action: 'implement', parallel: { role: qa, action: 'write_cases' } };
          case 'QA_CASES':
            return { next: `SPRINT_${N}_SA_TEST_REVIEW`, role: reviewer, action: 'review_test_cases', sprint: N };
          case 'DEV':
            // After parallel DEV + QA_CASES both complete, route to SA_TEST_REVIEW
            // so SA reviews the cases QA wrote in parallel, then continue to DOC_SYNC.
            return { next: `SPRINT_${N}_SA_TEST_REVIEW`, role: reviewer, action: 'review_test_cases', sprint: N };
          case 'SA_TEST_REVIEW':
            return { next: `SPRINT_${N}_PARSE_SA_TEST_REVIEW`, role: null, action: 'parse_test_review_conclusion', sprint: N };
          case 'SA_TEST_REVIEW_NEEDS_REVISION':
            return { next: `SPRINT_${N}_QA_CASES`, role: qa, action: 'revise_cases', sprint: N };
          case 'DOC_SYNC':
            return { next: `SPRINT_${N}_DOC_SYNC_DONE`, role: dev, action: 'sync_docs', sprint: N };
          case 'DOC_SYNC_DONE':
            return { next: `SPRINT_${N}_SA_CODE`, role: reviewer, action: 'review_code', sprint: N };
          case 'SA_CODE':
            return { next: `SPRINT_${N}_PARSE_SA_CODE`, role: null, action: 'parse_review_conclusion', sprint: N };
          case 'DEPLOY_GATE':
            if (!workflow.g2_enabled) return { next: `SPRINT_${N}_QA_RUN`, role: qa, action: 'run', sprint: N };
            if (workflow.g2_approved_sprints && workflow.g2_approved_sprints[N]) return { next: `SPRINT_${N}_QA_RUN`, role: qa, action: 'run', sprint: N };
            return { next: `SPRINT_${N}_DEPLOY_GATE`, role: null, action: 'await_deploy_approval', stop: true, sprint: N };
          case 'QA_RUN':
            return { next: `SPRINT_${N}_PARSE_QA_RUN`, role: null, action: 'parse_test_conclusion', sprint: N };
          case 'FIX':
            if (sprintDelivery === 'final_only') {
              return { next: `SPRINT_${N}_FIX_DONE`, role: dev, action: 'revise_implementation', sprint: N };
            }
            return { next: `SPRINT_${N}_QA_REGRESSION`, role: qa, action: 'regression', sprint: N };
          case 'FIX_DONE':
            if (sprintDelivery !== 'final_only') {
              return { next: state, role: null, action: 'unknown_phase' };
            }
            return { next: `SPRINT_${N}_SA_CODE`, role: reviewer, action: 'review_code', sprint: N };
          case 'QA_REGRESSION':
            return { next: `SPRINT_${N}_PARSE_QA_REGRESSION`, role: null, action: 'parse_regression_conclusion', sprint: N };
          case 'EVAL':
            return { next: `SPRINT_${N}_PARSE_EVAL`, role: null, action: 'parse_eval_conclusion', sprint: N };
          case 'DONE':
            if (sprint.total && N >= sprint.total) {
              return { next: 'ALL_SPRINTS_DONE', role: null, action: 'continue' };
            }
            return { next: `SPRINT_${N + 1}_KICKOFF`, role: null, action: 'kickoff_sprint' };
          case 'DEV_DONE':
            if (sprintDelivery !== 'final_only') {
              return { next: state, role: null, action: 'unknown_phase' };
            }
            if (sprint.total && N >= sprint.total) {
              return { next: 'ALL_SPRINTS_DEV_DONE', role: null, action: 'continue' };
            }
            return { next: `SPRINT_${N + 1}_KICKOFF`, role: null, action: 'kickoff_sprint' };
          default:
            return { next: state, role: null, action: 'unknown_phase' };
        }
      }

      if (state === 'ALL_SPRINTS_DONE') {
        return { next: 'FINAL_EVAL', role: evaluator, action: 'final_acceptance' };
      }
      if (state === 'ALL_SPRINTS_DEV_DONE') {
        return { next: 'INTEGRATION_REVIEW', role: reviewer, action: 'review_integration' };
      }
      if (state === 'INTEGRATION_REVIEW') {
        return { next: 'PARSE_INTEGRATION_REVIEW', role: null, action: 'parse_review_conclusion' };
      }
      if (state === 'INTEGRATION_REVIEW_NEEDS_REVISION') {
        return { next: 'INTEGRATION_FIX', role: dev, action: 'revise_integration' };
      }
      if (state === 'INTEGRATION_FIX') {
        return { next: 'INTEGRATION_REVIEW', role: reviewer, action: 'review_integration' };
      }
      if (state === 'TEST_RELEASE') {
        return nextTestReleaseStep({
          workflow,
          verifier: qa,
          initial: { next: 'FINAL_QA', action: 'run_final' },
          regression: { next: 'FINAL_QA', action: 'regression_final' },
        });
      }
      if (state === 'TEST_RELEASE_BLOCKED' || state === 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY') {
        return { next: state, role: null, action: 'await_human', stop: true };
      }
      if (state === 'FINAL_QA') {
        return { next: 'PARSE_FINAL_QA', role: null, action: 'parse_test_conclusion' };
      }
      if (state === 'FINAL_QA_PASSED') {
        return { next: 'FINAL_EVAL', role: evaluator, action: 'final_acceptance' };
      }
      if (state === 'FINAL_QA_BLOCKED') {
        return { next: 'FINAL_FIX', role: dev, action: 'fix_bug' };
      }
      if (state === 'FINAL_FIX') {
        return { next: 'FINAL_FIX_REVIEW', role: reviewer, action: 'review_final_fix' };
      }
      if (state === 'FINAL_FIX_REVIEW') {
        return { next: 'PARSE_FINAL_FIX_REVIEW', role: null, action: 'parse_review_conclusion' };
      }
      if (state === 'FINAL_FIX_REVIEW_NEEDS_REVISION') {
        return { next: 'FINAL_FIX', role: dev, action: 'revise_implementation' };
      }
      if (state === 'FINAL_ACCEPTANCE_REJECTED') {
        return { next: 'INTEGRATION_FIX', role: dev, action: 'revise_integration' };
      }
      if (state === 'FINAL_EVAL') {
        return { next: 'PARSE_FINAL_EVAL', role: null, action: 'parse_final_conclusion' };
      }
      if (state === 'TECH_LEAD_REVIEW') {
        return { next: 'SPEC_REVIEWING', role: reviewer, action: 'review_spec' };
      }

      return { next: state, role: null, action: 'unknown_state' };
  }
}

/**
 * fast 模式状态机：单 sprint，三角色合并。
 * 专为单接口/单模块小改动设计，比 full 少 ~50% 调用。
 *
 * 状态序列：
 *   INIT → REQ_DRAFTED → SPEC_DRAFTED → SPEC_REVIEWING
 *     → [SPEC_PENDING_HUMAN] → SPEC_APPROVED
 *     → BUILD → CODE_REVIEW → TEST_RELEASE → TEST → [FIX → FIX_REVIEW → TEST_RELEASE → REGRESSION]*
 *     → TEST_PASSED → ACCEPTANCE → COMPLETE
 *
 * CODE_REVIEW produces only sa-code-review.md (no test-report.md needed).
 * ACCEPTANCE produces acceptance.md after tests pass (test-report.md is available).
 * DEPLOY_GATE is skippable via preset config (g2_enabled: false).
 *
 * 与 full 的关键差异：
 *   - 没有 SPRINT_<N>_* 命名（强制单 sprint）
 *   - TEST 一次完成 cases + run（合并 QA cases/run）
 *   - ACCEPT 一次完成代码评审 + 契约验收（合并 SA code + Evaluator）
 *   - 熔断阈值更严（preset thresholds_override）
 */
function nextStepFast({ state, counters, thresholds, enabledRoles, humanGateApproved, workflow = {} }) {
  const has = (r) => enabledRoles.includes(r);
  // fast 模式三角色：fullstack / reviewer / verifier，缺一不可
  const fullstack = has('fullstack') ? 'fullstack' : has('developer') ? 'developer' : has('planner') ? 'planner' : null;
  const reviewer = has('reviewer') ? 'reviewer' : has('sa') ? 'sa' : null;
  const verifier = has('verifier') ? 'verifier' : has('qa') ? 'qa' : reviewer;

  if (TERMINAL.has(state)) {
    return { next: state, role: null, action: 'noop' };
  }

  // Circuit breakers ----------------------------------------------------------
  if (isFastReviewRevisionState(state) && counters.review_revision >= thresholds.review_revision) {
    return { next: 'SPEC_REVIEWING', role: fullstack, action: 'revise_spec', circuitBreaker: 'review' };
  }
  if (state === 'ACCEPTANCE_REJECTED' && counters.evaluator_reject >= thresholds.evaluator_reject) {
    return { next: 'SPEC_REVIEWING', role: fullstack, action: 'revise_spec', circuitBreaker: 'evaluator' };
  }
  if (state === 'FIX') {
    for (const [bug, n] of Object.entries(counters.fix_per_bug || {})) {
      if (n >= thresholds.fix_per_bug) {
        // fast 模式没有 TECH_LEAD_REVIEW 兜底岗，直接停下要人工
        return { next: 'HUMAN_INTERVENTION', role: null, action: 'await_human', circuitBreaker: 'fix', bug, stop: true };
      }
    }
  }

  // Backbone dispatch ---------------------------------------------------------
  switch (state) {
    case 'INIT':
      return { next: 'REQ_DRAFTED', role: null, action: 'await_requirements_md' };
    case 'REQ_DRAFTED':
      return { next: 'SPEC_DRAFTED', role: fullstack, action: 'draft_spec' };
    case 'SPEC_DRAFTED':
      return { next: 'SPEC_REVIEWING', role: reviewer, action: 'review_spec' };
    case 'SPEC_REVIEWING':
      return { next: 'PARSE_SPEC_REVIEW', role: null, action: 'parse_review_conclusion' };
    case 'SPEC_NEEDS_REVISION':
      return { next: 'SPEC_DRAFTED', role: fullstack, action: 'revise_spec' };
    case HUMAN_GATE:
      if (humanGateApproved) return { next: 'SPEC_APPROVED', role: null, action: 'continue' };
      return { next: HUMAN_GATE, role: null, action: 'await_human_approval', stop: true };
    case 'SPEC_APPROVED':
      return { next: 'BUILD', role: fullstack, action: 'implement' };
    case 'BUILD':
      // After coding → code review only (no acceptance yet, no test-report available)
      return { next: 'CODE_REVIEW', role: reviewer, action: 'review_code' };
    case 'CODE_REVIEW':
      return { next: 'PARSE_CODE_REVIEW', role: null, action: 'parse_review_conclusion' };
    case 'CODE_REVIEW_NEEDS_REVISION':
      return { next: 'BUILD', role: fullstack, action: 'revise_implementation' };
    case 'DEPLOY_GATE':
      // After code review passes → human merges to test + deploys → then QA
      // Skip if g2_enabled is false (preset config)
      if (!workflow.g2_enabled) return { next: 'TEST', role: verifier, action: 'verify_initial' };
      if (workflow.g2_approved) return { next: 'TEST', role: verifier, action: 'verify_initial' };
      return { next: 'DEPLOY_GATE', role: null, action: 'await_deploy_approval', stop: true };
    case 'TEST_RELEASE':
      return nextTestReleaseStep({
        workflow,
        verifier,
        initial: { next: 'TEST', action: 'verify_initial' },
        regression: { next: 'REGRESSION', action: 'verify_regression' },
      });
    case 'TEST_RELEASE_BLOCKED':
    case 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY':
      return { next: state, role: null, action: 'await_human', stop: true };
    case 'TEST':
      return { next: 'PARSE_TEST', role: null, action: 'parse_test_conclusion' };
    case 'TEST_BLOCKED':
      return { next: 'FIX', role: fullstack, action: 'fix_bug' };
    case 'FIX':
      return { next: 'FIX_REVIEW', role: reviewer, action: 'review_code' };
    case 'FIX_REVIEW':
      return { next: 'PARSE_FIX_REVIEW', role: null, action: 'parse_review_conclusion' };
    case 'FIX_REVIEW_NEEDS_REVISION':
      return { next: 'FIX', role: fullstack, action: 'revise_implementation' };
    case 'REGRESSION':
      return { next: 'PARSE_REGRESSION', role: null, action: 'parse_regression_conclusion' };
    case 'TEST_PASSED':
      // Tests passed → final contract acceptance (test-report.md now available)
      return { next: 'ACCEPTANCE', role: reviewer, action: 'accept' };
    case 'ACCEPTANCE':
      return { next: 'PARSE_ACCEPTANCE', role: null, action: 'parse_accept_conclusion' };
    case 'ACCEPTANCE_REJECTED':
      return { next: 'BUILD', role: fullstack, action: 'revise_implementation' };
    default:
      return { next: state, role: null, action: 'unknown_state' };
  }
}

function nextTestReleaseStep({ workflow, verifier, initial, regression }) {
  const release = workflow.test_release || {};
  const policy = release.policy || (workflow.g2_enabled === false ? 'disabled' : 'manual');
  const status = release.status || 'idle';
  const attempt = Number(release.attempt || 0);

  if (policy === 'disabled' || workflow.g2_enabled === false) {
    return { ...initial, role: verifier };
  }
  if (status === 'succeeded' || status === 'verified' || workflow.g2_approved === true) {
    return { ...(attempt > 1 ? regression : initial), role: verifier };
  }
  if (status === 'failed') {
    return { next: 'TEST_RELEASE_BLOCKED', role: null, action: 'await_human', stop: true };
  }
  if (status === 'deployed_needs_manual_verification') {
    return { next: 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY', role: null, action: 'await_human', stop: true };
  }
  if (policy === 'manual' || release.prerequisites_met === false) {
    return { next: 'TEST_RELEASE', role: null, action: 'await_deploy_approval', stop: true };
  }
  return { next: 'TEST_RELEASE', role: null, action: 'release_test' };
}

export const STATES = {
  TERMINAL,
  HUMAN_GATE,
};
