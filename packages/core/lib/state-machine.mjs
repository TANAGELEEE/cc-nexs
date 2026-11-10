// cc-nexs core: state machine.
// Pure logic: given a state + counters + role-list, decide next state and the role/action to invoke.
// Side-effects (calling reviewer, writing progress) live in the orchestrator command, not here.

const TERMINAL = new Set(['COMPLETE']);

/**
 * Decide the next state and the role/action to invoke for a Lean or Hotfix task.
 *
 *   mode='lean' — plan-first, two-gate, verification-led pipeline. A consolidated
 *     Review runs only where the review policy requires one (high/critical, sensitive
 *     paths), and then before test; test verification is the gate for everything:
 *     INIT → PLANNING → PLAN_REVIEWING → PLAN_PENDING_HUMAN → PLAN_APPROVED → IMPLEMENTING
 *       → LOCAL_VERIFYING → [CONSOLIDATED_REVIEW] → CANDIDATE_READY → TEST_RELEASE
 *       → TEST_VERIFYING → TEST_VERIFIED → RELEASE_PENDING_HUMAN
 *       → BASE_MERGING → COMPLETE
 *     An independent plan review precedes Gateway A; a blocked plan gets one revision and
 *     re-review, after which open findings go to Gateway A for the human to decide.
 *     Consolidated blockers take one bounded fix + delta-review closure. Gateway B
 *     implementation feedback takes one bounded local reverify + delta Review and
 *     a new test attempt; scope feedback invalidates Gateway A and returns to planning.
 *
 *   mode='hotfix' — standalone mini-Lean pipeline on its own latest-base worktree:
 *     INIT → HOTFIX_IMPLEMENTING → HOTFIX_LOCAL_VERIFYING
 *       → [P0/P1: HOTFIX_REVIEWING → HOTFIX_FIXING → HOTFIX_LOCAL_REVERIFYING → HOTFIX_DELTA_REVIEW]
 *       → HOTFIX_CANDIDATE_READY → HOTFIX_TEST_RELEASE → HOTFIX_TEST_VERIFYING
 *       → HOTFIX_RELEASE_PENDING_HUMAN → HOTFIX_BASE_MERGING → COMPLETE
 *     P0/P1 keep an independent Review before test; P2/P3 are gated by test verification.
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
  // P0/P1 are reviewed before test; P2/P3 are gated by test verification.
  const reviewRequired = workflow.review?.required !== false;

  if (TERMINAL.has(state)) return { next: state, role: null, action: 'noop' };
  // A tested candidate synced with a moved base and built locally goes to its MR; it is
  // neither reviewed nor tested again (base-sync-carry proves it is only that merge).
  if (['HOTFIX_LOCAL_VERIFYING', 'HOTFIX_LOCAL_REVERIFYING'].includes(state) && workflow.base_sync?.carried) {
    return workflow.base_sync.approved
      ? { next: 'HOTFIX_BASE_MERGING', role: null, action: 'release_base' }
      : { next: 'HOTFIX_RELEASE_PENDING_HUMAN', role: null, action: 'await_release_approval', stop: true };
  }
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
      if (!reviewRequired) return { next: 'HOTFIX_CANDIDATE_READY', role: null, action: 'continue_to_test' };
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
      if (!reviewRequired) return { next: 'HOTFIX_CANDIDATE_READY', role: null, action: 'continue_to_test' };
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
  const planReviewer = has('lean-plan-reviewer') ? 'lean-plan-reviewer' : null;
  const developer = has('lean-developer') ? 'lean-developer' : null;
  const reviewer = has('lean-reviewer') ? 'lean-reviewer' : null;
  const verifier = has('lean-verifier') ? 'lean-verifier' : reviewer;
  const planApproved = workflow.plan_approved ?? humanGateApproved;
  const releaseApproved = workflow.release_approved === true;
  // Every Lean candidate is verified in test first; a code Review follows only where
  // the review policy requires one (high/critical plans, sensitive paths).
  const reviewRequired = workflow.review?.required !== false;
  const reviewStatus = workflow.review?.status || workflow.review_status || 'idle';
  const reviewExact = workflow.review?.exact === true;
  const closureAttempts = Number(workflow.review?.closure_attempts || 0);
  const gatewayBDeltaAttempts = Number(workflow.review?.gateway_b_delta_attempts || 0);
  const testReleaseStatus = workflow.test_release?.status || 'idle';
  const testExact = workflow.test_release?.exact !== false;
  const reviewSatisfied = !reviewRequired || (reviewExact && reviewStatus === 'passed');
  const derivedPending = workflow.derived_binding?.status === 'pending';

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
      return { next: 'PLAN_REVIEWING', role: planReviewer, action: 'review_plan' };
    case 'PLAN_REVIEWING':
      return { next: 'PARSE_PLAN_REVIEW', role: null, action: 'parse_plan_review_conclusion' };
    case 'PLAN_REVIEW_BLOCKED':
      return { next: 'PLANNING', role: planner, action: 'revise_plan' };
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
      // A tested candidate synced with a moved base and built locally goes to its MR; it is
      // neither reviewed nor tested again (base-sync-carry proves it is only that merge).
      if (workflow.base_sync?.carried) {
        return workflow.base_sync.approved
          ? { next: 'BASE_MERGING', role: null, action: 'release_base' }
          : { next: 'RELEASE_PENDING_HUMAN', role: null, action: 'await_release_approval', stop: true };
      }
      // A required Review (high/critical, sensitive paths) comes before test; otherwise
      // the candidate goes straight to test and verification is the gate.
      if (!reviewRequired) return { next: 'CANDIDATE_READY', role: null, action: 'continue_to_test' };
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
      // Without a required Review a fix goes straight back to test; with one, the
      // changed code gets the delta closure before it is tested again.
      if (!reviewRequired) return { next: 'CANDIDATE_READY', role: null, action: 'continue_to_test' };
      if (reviewExact && closureAttempts > 0) {
        return { next: 'REVIEW_CLOSURE', role: null, action: 'continue' };
      }
      return { next: 'REVIEW_CLOSURE', role: reviewer, action: 'review_delta' };
    case 'REVIEW_CLOSURE':
      return { next: 'PARSE_REVIEW_CLOSURE', role: null, action: 'parse_review_conclusion' };
    case 'CANDIDATE_READY':
      if (testReleaseStatus === 'verified' && testExact && reviewSatisfied && !derivedPending) {
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
      // Deferred derived data is generated once the source passes Test, and that
      // final candidate gets its own local check, Review and Test attempt.
      if (derivedPending) return { next: 'TEST_FIXING', role: developer, action: 'bind_derived' };
      if (reviewRequired && reviewExact && reviewStatus === 'blocked') {
        return { next: 'CONSOLIDATED_REVIEW', role: null, action: 'continue' };
      }
      if (!reviewSatisfied) {
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
      if (!reviewRequired) return { next: 'CANDIDATE_READY', role: null, action: 'continue_to_test' };
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

// States an action from each state may end in besides the `next` that nextStep() returns:
// parse outcomes, local-verification failures, release results, and base drift. `advance`
// accepts only these (or nextStep's own `next`); anything else is a human-authorized recovery.
const LEAN_OUTCOMES = {
  PLANNING: ['PLAN_REVIEWING', 'PLAN_PENDING_HUMAN'],
  PLAN_REVIEWING: ['PARSE_PLAN_REVIEW', 'PLAN_PENDING_HUMAN', 'PLAN_REVIEW_BLOCKED'],
  PARSE_PLAN_REVIEW: ['PLAN_PENDING_HUMAN', 'PLAN_REVIEW_BLOCKED'],
  IMPLEMENTING: ['LOCAL_VERIFYING', 'LOCAL_VERIFY_FAILED'],
  LOCAL_VERIFYING: ['CANDIDATE_READY', 'CONSOLIDATED_REVIEW', 'LOCAL_VERIFY_FAILED'],
  REVIEW_FIXING: ['LOCAL_REVERIFYING', 'LOCAL_REVERIFY_FAILED'],
  TEST_FIXING: ['LOCAL_REVERIFYING', 'LOCAL_REVERIFY_FAILED'],
  LOCAL_REVERIFYING: ['CANDIDATE_READY', 'REVIEW_CLOSURE', 'LOCAL_REVERIFY_FAILED'],
  GATEWAY_B_FIXING: ['GATEWAY_B_LOCAL_REVERIFYING', 'LOCAL_REVERIFY_FAILED'],
  GATEWAY_B_LOCAL_REVERIFYING: ['CANDIDATE_READY', 'GATEWAY_B_DELTA_REVIEW', 'LOCAL_REVERIFY_FAILED'],
  CONSOLIDATED_REVIEW: ['PARSE_CONSOLIDATED_REVIEW'],
  PARSE_CONSOLIDATED_REVIEW: ['CANDIDATE_READY', 'CONSOLIDATED_REVIEW_BLOCKED'],
  REVIEW_CLOSURE: ['PARSE_REVIEW_CLOSURE'],
  PARSE_REVIEW_CLOSURE: ['CANDIDATE_READY', 'REVIEW_CLOSURE_BLOCKED'],
  GATEWAY_B_DELTA_REVIEW: ['PARSE_GATEWAY_B_DELTA_REVIEW'],
  PARSE_GATEWAY_B_DELTA_REVIEW: ['CANDIDATE_READY', 'GATEWAY_B_DELTA_REVIEW_BLOCKED'],
  CANDIDATE_READY: ['TEST_RELEASE', 'RELEASE_PENDING_HUMAN', 'BASE_CHANGED'],
  TEST_RELEASE: ['TEST_VERIFYING', 'TEST_VERIFIED', 'TEST_MERGE_CONFLICT', 'TEST_RELEASE_BLOCKED', 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY'],
  TEST_MERGE_CONFLICT: ['TEST_RELEASE'],
  TEST_RELEASE_BLOCKED: ['TEST_RELEASE'],
  TEST_VERIFYING: ['PARSE_TEST_VERIFY', 'TEST_VERIFIED', 'TEST_VERIFY_FAILED', 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY'],
  PARSE_TEST_VERIFY: ['TEST_VERIFIED', 'TEST_VERIFY_FAILED'],
  TEST_DEPLOYED_NEEDS_MANUAL_VERIFY: ['TEST_VERIFIED', 'TEST_VERIFY_FAILED', 'RELEASE_PENDING_HUMAN'],
  TEST_VERIFIED: ['CONSOLIDATED_REVIEW', 'RELEASE_PENDING_HUMAN', 'TEST_FIXING', 'BASE_CHANGED'],
  RELEASE_PENDING_HUMAN: ['BASE_MERGING', 'BASE_CHANGED'],
  BASE_MERGING: ['COMPLETE', 'BASE_CHANGED', 'BASE_MERGE_BLOCKED'],
  BASE_CHANGED: ['IMPLEMENTING', 'LOCAL_VERIFYING'],
};
const HOTFIX_OUTCOMES = {
  HOTFIX_IMPLEMENTING: ['HOTFIX_IMPLEMENTED'],
  HOTFIX_IMPLEMENTED: ['HOTFIX_LOCAL_VERIFYING'],
  HOTFIX_LOCAL_VERIFYING: ['HOTFIX_REVIEWING', 'HOTFIX_CANDIDATE_READY', 'HOTFIX_LOCAL_VERIFY_FAILED'],
  HOTFIX_LOCAL_VERIFY_FAILED: ['HOTFIX_IMPLEMENTED'],
  HOTFIX_REVIEWING: ['PARSE_HOTFIX_REVIEW'],
  PARSE_HOTFIX_REVIEW: ['HOTFIX_CANDIDATE_READY', 'HOTFIX_REVIEW_BLOCKED'],
  HOTFIX_FIXING: ['HOTFIX_LOCAL_REVERIFYING', 'HOTFIX_LOCAL_REVERIFY_FAILED'],
  HOTFIX_LOCAL_REVERIFYING: ['HOTFIX_DELTA_REVIEW', 'HOTFIX_CANDIDATE_READY', 'HOTFIX_LOCAL_REVERIFY_FAILED'],
  HOTFIX_DELTA_REVIEW: ['PARSE_HOTFIX_DELTA_REVIEW'],
  PARSE_HOTFIX_DELTA_REVIEW: ['HOTFIX_CANDIDATE_READY', 'HOTFIX_DELTA_REVIEW_BLOCKED'],
  HOTFIX_CANDIDATE_READY: ['HOTFIX_TEST_RELEASE'],
  HOTFIX_TEST_RELEASE: ['HOTFIX_TEST_VERIFYING', 'HOTFIX_TEST_VERIFIED', 'HOTFIX_TEST_MERGE_CONFLICT', 'HOTFIX_TEST_RELEASE_BLOCKED', 'HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY'],
  HOTFIX_TEST_MERGE_CONFLICT: ['HOTFIX_TEST_RELEASE'],
  HOTFIX_TEST_RELEASE_BLOCKED: ['HOTFIX_TEST_RELEASE'],
  HOTFIX_TEST_VERIFYING: ['PARSE_HOTFIX_TEST', 'HOTFIX_TEST_VERIFIED', 'HOTFIX_TEST_FAILED', 'HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY'],
  PARSE_HOTFIX_TEST: ['HOTFIX_TEST_VERIFIED', 'HOTFIX_TEST_FAILED'],
  HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY: ['HOTFIX_TEST_VERIFIED', 'HOTFIX_TEST_FAILED', 'HOTFIX_RELEASE_PENDING_HUMAN'],
  HOTFIX_TEST_VERIFIED: ['HOTFIX_RELEASE_PENDING_HUMAN', 'HOTFIX_BASE_CHANGED'],
  HOTFIX_RELEASE_PENDING_HUMAN: ['HOTFIX_BASE_MERGING', 'HOTFIX_BASE_CHANGED'],
  HOTFIX_BASE_MERGING: ['COMPLETE', 'HOTFIX_BASE_CHANGED', 'HOTFIX_BASE_MERGE_BLOCKED'],
  HOTFIX_BASE_CHANGED: ['HOTFIX_FIXING', 'HOTFIX_LOCAL_REVERIFYING'],
};

// Whether `advance` may move a task from `from` to `to` without a recovery authorization.
// Escalating to HUMAN_INTERVENTION is always allowed; leaving it is a human decision.
export const REVIEW_STATES = new Set(['CONSOLIDATED_REVIEW', 'REVIEW_CLOSURE', 'GATEWAY_B_DELTA_REVIEW', 'HOTFIX_REVIEWING', 'HOTFIX_DELTA_REVIEW']);

export function isAllowedTransition({ mode, from, to, next, reviewRequired = true }) {
  if (to === 'HUMAN_INTERVENTION') return true;
  if (from === 'HUMAN_INTERVENTION') return false;
  if (to === next) return true;
  // A Review state is an outcome only for a candidate that needs a Review.
  if (!reviewRequired && REVIEW_STATES.has(to)) return false;
  const outcomes = mode === 'hotfix' ? HOTFIX_OUTCOMES : LEAN_OUTCOMES;
  return (outcomes[from] || []).includes(to);
}
