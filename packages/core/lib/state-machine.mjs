// cc-nexs core: state machine.
// Pure logic: given a state + counters + role-list, decide next state and the role/action to invoke.
// Side-effects (calling reviewer, writing progress) live in the orchestrator command, not here.

const TERMINAL = new Set(['COMPLETE']);

/**
 * Decide the next state and the role/action to invoke for a Lean or Hotfix task.
 *
 *   mode='lean' — plan-first, two-gate, one-consolidated-review pipeline.
 *     Eligible fast-track work reaches test before the consolidated Review;
 *     standard work keeps Review before test. Both require Review + verified test
 *     evidence for the exact candidate before Gateway B:
 *     INIT → PLANNING → PLAN_PENDING_HUMAN → PLAN_APPROVED → IMPLEMENTING
 *       → LOCAL_VERIFYING → [CONSOLIDATED_REVIEW] → CANDIDATE_READY
 *       → TEST_RELEASE → TEST_VERIFYING → [CONSOLIDATED_REVIEW] → RELEASE_PENDING_HUMAN
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
 *     Every severity retains independent Review; diff size is not proof of unchanged behavior.
 *
 */
export function nextStep({
  state,
  counters = {},
  thresholds = { review_revision: 3, fix_per_bug: 3 },
  enabledRoles,
  humanGateApproved = false,
  workflow = {},
  mode = 'lean',
}) {
  if (mode === 'lean') {
    return nextStepLean({ state, counters, thresholds, enabledRoles, humanGateApproved, workflow });
  }
  if (mode === 'hotfix') {
    return nextStepHotfix({ state, counters, thresholds, enabledRoles, workflow });
  }
  throw new Error(`[cc-nexs] unsupported mode: ${mode}`);
}

function nextStepHotfix({ state, counters, thresholds, enabledRoles, workflow = {} }) {
  const has = (role) => enabledRoles.includes(role);
  const developer = has('hotfix-developer') ? 'hotfix-developer' : has('lean-developer') ? 'lean-developer' : null;
  const reviewer = has('hotfix-reviewer') ? 'hotfix-reviewer' : has('lean-reviewer') ? 'lean-reviewer' : null;
  const verifier = has('hotfix-verifier') ? 'hotfix-verifier' : has('lean-verifier') ? 'lean-verifier' : reviewer;
  const severity = workflow.hotfix?.severity || workflow.hotfix_severity || null;
  const releaseApproved = workflow.release_approved === true;
  const deltaAttempts = Number(workflow.hotfix?.delta_attempts || 0);
  const testFailures = Number(counters.fix_per_bug?.HOTFIX_TEST || 0);
  const reviewStatus = workflow.review?.status || 'idle';
  const reviewExact = workflow.review?.exact === true;
  const closureAttempts = Number(workflow.review?.closure_attempts || 0);

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
      if (reviewExact && ['passed', 'blocked'].includes(reviewStatus)) {
        return { next: 'HOTFIX_REVIEWING', role: null, action: 'continue' };
      }
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
      if (reviewExact && closureAttempts > 0) {
        return { next: 'HOTFIX_DELTA_REVIEW', role: null, action: 'continue' };
      }
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
    case 'HOTFIX_TEST_MERGE_CONFLICT':
      return { next: state, role: developer, action: 'resolve_test_conflict' };
    case 'HOTFIX_TEST_RELEASE_BLOCKED':
      return { next: state, role: null, action: 'await_human', stop: true };
    case 'HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY':
      if (workflow.test_release?.status === 'verified') {
        return { next: 'HOTFIX_TEST_VERIFIED', role: null, action: 'continue' };
      }
      if (workflow.test_release?.status === 'failed') {
        return { next: 'HOTFIX_TEST_FAILED', role: null, action: 'continue' };
      }
      return { next: state, role: null, action: 'await_human', stop: true };
    case 'HOTFIX_TEST_VERIFYING':
      if (workflow.test_release?.status === 'verified') {
        return { next: 'HOTFIX_TEST_VERIFIED', role: null, action: 'continue' };
      }
      if (workflow.test_release?.status === 'failed') {
        return { next: 'HOTFIX_TEST_FAILED', role: null, action: 'continue' };
      }
      if (workflow.test_release?.status === 'deployed_needs_manual_verification') {
        return { next: 'HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY', role: null, action: 'await_human', stop: true };
      }
      return { next: 'PARSE_HOTFIX_TEST', role: null, action: 'parse_test_conclusion' };
    case 'HOTFIX_TEST_VERIFIED':
      return { next: 'HOTFIX_RELEASE_PENDING_HUMAN', role: null, action: 'await_release_approval', stop: true };
    case 'HOTFIX_RELEASE_PENDING_HUMAN':
      if (releaseApproved) return { next: 'HOTFIX_BASE_MERGING', role: null, action: 'release_base' };
      return { next: state, role: null, action: 'await_release_approval', stop: true };
    case 'HOTFIX_BASE_MERGING':
      if (workflow.base_release?.status === 'succeeded') {
        return { next: 'COMPLETE', role: null, action: 'complete' };
      }
      if (['idle', 'running'].includes(workflow.base_release?.status || 'idle')) {
        return { next: state, role: null, action: 'release_base' };
      }
      return { next: 'HOTFIX_BASE_MERGE_BLOCKED', role: null, action: 'await_human', stop: true };
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
  if (status === 'verified') return { next: 'HOTFIX_TEST_VERIFIED', role: null, action: 'continue' };
  if (status === 'succeeded') {
    return { next: 'HOTFIX_TEST_VERIFYING', role: verifier, action: attempt > 1 ? 'verify_hotfix_regression' : 'verify_hotfix_test' };
  }
  if (['deploying', 'awaiting_receipt'].includes(status)) return { next: 'HOTFIX_TEST_RELEASE', role: null, action: 'poll_test_release' };
  if (status === 'configuration_blocked') return { next: 'HOTFIX_TEST_RELEASE_BLOCKED', role: null, action: 'configure_test_release', stop: true };
  if (status === 'merge_conflict') return { next: 'HOTFIX_TEST_MERGE_CONFLICT', role: null, action: 'resolve_test_conflict' };
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
  const planner = has('lean-planner') ? 'lean-planner' : null;
  const developer = has('lean-developer') ? 'lean-developer' : null;
  const reviewer = has('lean-reviewer') ? 'lean-reviewer' : null;
  const verifier = has('lean-verifier') ? 'lean-verifier' : reviewer;
  const planApproved = workflow.plan_approved ?? humanGateApproved;
  const releaseApproved = workflow.release_approved === true;
  const deliveryLane = workflow.delivery_lane || (workflow.lean_fast_track === true ? 'fast-track' : 'standard');
  const fastTrack = deliveryLane === 'fast-track';
  const reviewStatus = workflow.review?.status || workflow.review_status || 'idle';
  const reviewExact = workflow.review?.exact === true;
  const closureAttempts = Number(workflow.review?.closure_attempts || 0);
  const gatewayBDeltaAttempts = Number(workflow.review?.gateway_b_delta_attempts || 0);
  const testReleaseStatus = workflow.test_release?.status || 'idle';

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
      if (fastTrack) return { next: 'CANDIDATE_READY', role: null, action: 'continue_to_test' };
      if (reviewExact && ['passed', 'blocked'].includes(reviewStatus)) {
        return { next: 'CONSOLIDATED_REVIEW', role: null, action: 'continue' };
      }
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
      if (fastTrack && workflow.local_verification?.context === 'test' && reviewStatus === 'idle') {
        return { next: 'CANDIDATE_READY', role: null, action: 'continue_to_test' };
      }
      if (reviewExact && closureAttempts > 0) {
        return { next: 'REVIEW_CLOSURE', role: null, action: 'continue' };
      }
      return { next: 'REVIEW_CLOSURE', role: reviewer, action: 'review_delta' };
    case 'REVIEW_CLOSURE':
      return { next: 'PARSE_REVIEW_CLOSURE', role: null, action: 'parse_review_conclusion' };
    case 'CANDIDATE_READY':
      if (fastTrack && testReleaseStatus === 'verified' && reviewStatus === 'passed') {
        return { next: 'RELEASE_PENDING_HUMAN', role: null, action: 'await_release_approval', stop: true };
      }
      return { next: 'TEST_RELEASE', role: null, action: 'continue' };
    case 'TEST_RELEASE':
      return nextTestReleaseStep({
        workflow,
        verifier,
        initial: { next: 'TEST_VERIFYING', action: 'verify_test' },
        regression: { next: 'TEST_VERIFYING', action: 'verify_test_regression' },
        verified: { next: 'TEST_VERIFIED', action: 'continue' },
      });
    case 'TEST_MERGE_CONFLICT':
      return { next: state, role: developer, action: 'resolve_test_conflict' };
    case 'TEST_RELEASE_BLOCKED':
      return { next: state, role: null, action: 'await_human', stop: true };
    case 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY':
      if (testReleaseStatus === 'verified') {
        return { next: 'TEST_VERIFIED', role: null, action: 'continue' };
      }
      if (testReleaseStatus === 'failed') {
        return { next: 'TEST_VERIFY_FAILED', role: null, action: 'continue' };
      }
      return { next: state, role: null, action: 'await_human', stop: true };
    case 'TEST_VERIFYING':
      if (testReleaseStatus === 'verified') {
        return { next: 'TEST_VERIFIED', role: null, action: 'continue' };
      }
      if (testReleaseStatus === 'failed') {
        return { next: 'TEST_VERIFY_FAILED', role: null, action: 'continue' };
      }
      if (testReleaseStatus === 'deployed_needs_manual_verification') {
        return { next: 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY', role: null, action: 'await_human', stop: true };
      }
      return { next: 'PARSE_TEST_VERIFY', role: null, action: 'parse_test_conclusion' };
    case 'TEST_VERIFY_FAILED':
      return { next: 'TEST_FIXING', role: developer, action: 'fix_test' };
    case 'TEST_VERIFIED':
      if (fastTrack && reviewExact && reviewStatus === 'blocked') {
        return { next: 'CONSOLIDATED_REVIEW', role: null, action: 'continue' };
      }
      if (fastTrack && (!reviewExact || reviewStatus !== 'passed')) {
        return { next: 'CONSOLIDATED_REVIEW', role: reviewer, action: 'review_tested_candidate' };
      }
      return { next: 'RELEASE_PENDING_HUMAN', role: null, action: 'await_release_approval', stop: true };
    case 'RELEASE_PENDING_HUMAN':
      if (releaseApproved) return { next: 'BASE_MERGING', role: null, action: 'release_base' };
      return { next: state, role: null, action: 'await_release_approval', stop: true };
    case 'GATEWAY_B_CHANGE_REQUESTED':
      return { next: 'GATEWAY_B_FIXING', role: developer, action: 'fix_gateway_b_feedback' };
    case 'GATEWAY_B_FIXING':
      return { next: 'GATEWAY_B_LOCAL_REVERIFYING', role: null, action: 'verify_local' };
    case 'GATEWAY_B_LOCAL_REVERIFYING':
      if (reviewExact && gatewayBDeltaAttempts > 0) {
        return { next: 'GATEWAY_B_DELTA_REVIEW', role: null, action: 'continue' };
      }
      return { next: 'GATEWAY_B_DELTA_REVIEW', role: reviewer, action: 'review_gateway_b_delta' };
    case 'GATEWAY_B_DELTA_REVIEW':
      return { next: 'PARSE_GATEWAY_B_DELTA_REVIEW', role: null, action: 'parse_review_conclusion' };
    case 'GATEWAY_B_DELTA_REVIEW_BLOCKED':
      return { next: 'HUMAN_INTERVENTION', role: null, action: 'await_human', circuitBreaker: 'gateway_b_review', stop: true };
    case 'BASE_MERGING':
      if (workflow.base_release?.status === 'succeeded') {
        return { next: 'COMPLETE', role: null, action: 'complete' };
      }
      if (['idle', 'running'].includes(workflow.base_release?.status || 'idle')) {
        return { next: state, role: null, action: 'release_base' };
      }
      return { next: 'BASE_MERGE_BLOCKED', role: null, action: 'await_human', stop: true };
    case 'BASE_CHANGED':
      return { next: 'IMPLEMENTING', role: developer, action: 'sync_base' };
    case 'BASE_MERGE_BLOCKED':
    case 'HUMAN_INTERVENTION':
      return { next: state, role: null, action: 'await_human', stop: true };
    default:
      return { next: state, role: null, action: 'unknown_state' };
  }
}

function nextTestReleaseStep({ workflow, verifier, initial, regression, verified = initial }) {
  const release = workflow.test_release || {};
  const policy = release.policy || 'manual';
  const status = release.status || 'idle';
  const attempt = Number(release.attempt || 0);

  if (policy === 'disabled') {
    return { ...initial, role: verifier };
  }
  if (status === 'verified') return { ...verified, role: verified.role ?? null };
  if (status === 'succeeded') {
    return { ...(attempt > 1 ? regression : initial), role: verifier };
  }
  if (['deploying', 'awaiting_receipt'].includes(status)) {
    return { next: 'TEST_RELEASE', role: null, action: 'poll_test_release' };
  }
  if (status === 'merge_conflict') return { next: 'TEST_MERGE_CONFLICT', role: null, action: 'resolve_test_conflict' };
  if (status === 'configuration_blocked') return { next: 'TEST_RELEASE_BLOCKED', role: null, action: 'configure_test_release', stop: true };
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
};
