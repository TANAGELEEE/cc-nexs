// Smoke tests for state-machine.
// Run: npm run test:hooks

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStep } from './state-machine.mjs';

const baseFull = {
  counters: { review_revision: 0, fix_per_bug: {}, evaluator_reject: 0 },
  thresholds: { review_revision: 3, fix_per_bug: 3, evaluator_reject: 2 },
  sprint: { current: 1, total: 2 },
  humanGateApproved: false,
  mode: 'full',
};

const fullRoles = ['repo-scout', 'planner', 'tech-lead', 'sa', 'qa', 'evaluator'];

// --- RECON path ---

test('full mode: REQ_DRAFTED → RECON_DONE when repo-scout enabled', () => {
  const r = nextStep({ ...baseFull, state: 'REQ_DRAFTED', enabledRoles: fullRoles });
  assert.equal(r.next, 'RECON_DONE');
  assert.equal(r.role, 'repo-scout');
  assert.equal(r.action, 'recon');
});

test('full mode: REQ_DRAFTED → SPEC_DRAFTED when repo-scout NOT enabled (back-compat)', () => {
  const r = nextStep({
    ...baseFull,
    state: 'REQ_DRAFTED',
    enabledRoles: ['planner', 'tech-lead', 'sa', 'qa', 'evaluator'],
  });
  assert.equal(r.next, 'SPEC_DRAFTED');
  assert.equal(r.role, 'planner');
  assert.equal(r.action, 'draft_spec');
});

test('full mode: RECON_DONE → SPEC_DRAFTED with planner', () => {
  const r = nextStep({ ...baseFull, state: 'RECON_DONE', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPEC_DRAFTED');
  assert.equal(r.role, 'planner');
  assert.equal(r.action, 'draft_spec');
});

test('full mode: SPEC_NEEDS_REVISION goes to SPEC_DRAFTED (does NOT re-run recon)', () => {
  const r = nextStep({ ...baseFull, state: 'SPEC_NEEDS_REVISION', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPEC_DRAFTED');
  assert.equal(r.role, 'planner');
  assert.equal(r.action, 'revise_spec');
});

// --- Sprint phase transitions (full mode) ---

test('full mode: SPRINT_1_KICKOFF → SPRINT_1_DEV with parallel QA cases', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_1_KICKOFF', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPRINT_1_DEV');
  assert.equal(r.role, 'tech-lead');
  assert.equal(r.action, 'implement');
  assert.equal(r.parallel.role, 'qa');
  assert.equal(r.parallel.action, 'write_cases');
  assert.equal(r.fanout, 'implementation_repositories');
});

test('full mode: SPRINT_1_DEV → SPRINT_1_SA_TEST_REVIEW (SA reviews cases after parallel DEV+QA_CASES)', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_1_DEV', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPRINT_1_SA_TEST_REVIEW');
  assert.equal(r.role, 'sa');
  assert.equal(r.action, 'review_test_cases');
});

test('full per-sprint mode: SPRINT_1_DOC_SYNC dispatches document sync before code review', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_1_DOC_SYNC', enabledRoles: fullRoles });
  assert.deepEqual(r, {
    next: 'SPRINT_1_DOC_SYNC_DONE', role: 'tech-lead', action: 'sync_docs', sprint: 1,
  });
});

test('full mode: SPRINT_1_QA_CASES → SPRINT_1_SA_TEST_REVIEW', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_1_QA_CASES', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPRINT_1_SA_TEST_REVIEW');
  assert.equal(r.role, 'sa');
  assert.equal(r.action, 'review_test_cases');
});

test('full mode: rejected SA test-case review dispatches QA revision before fresh review', () => {
  const revise = nextStep({
    ...baseFull,
    state: 'SPRINT_1_SA_TEST_REVIEW_NEEDS_REVISION',
    enabledRoles: fullRoles,
  });
  assert.deepEqual(revise, {
    next: 'SPRINT_1_QA_CASES', role: 'qa', action: 'revise_cases', sprint: 1,
  });

  const review = nextStep({ ...baseFull, state: revise.next, enabledRoles: fullRoles });
  assert.deepEqual(review, {
    next: 'SPRINT_1_SA_TEST_REVIEW', role: 'sa', action: 'review_test_cases', sprint: 1,
  });
});

test('full mode: SPRINT_1_FIX → SPRINT_1_QA_REGRESSION', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_1_FIX', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPRINT_1_QA_REGRESSION');
  assert.equal(r.role, 'qa');
  assert.equal(r.action, 'regression');
});

test('full mode: SPRINT_2_DONE → ALL_SPRINTS_DONE when N >= total', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_2_DONE', enabledRoles: fullRoles });
  assert.equal(r.next, 'ALL_SPRINTS_DONE');
});

test('full mode: SPRINT_1_DONE → SPRINT_2_KICKOFF when more sprints remain', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_1_DONE', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPRINT_2_KICKOFF');
});

test('full final-only mode: development sprints finish without a deploy gate', () => {
  const first = nextStep({
    ...baseFull,
    state: 'SPRINT_1_DEV_DONE',
    enabledRoles: fullRoles,
    workflow: { sprint_delivery: 'final_only' },
  });
  assert.equal(first.next, 'SPRINT_2_KICKOFF');

  const last = nextStep({
    ...baseFull,
    state: 'SPRINT_2_DEV_DONE',
    enabledRoles: fullRoles,
    workflow: { sprint_delivery: 'final_only' },
  });
  assert.equal(last.next, 'ALL_SPRINTS_DEV_DONE');
});

test('historical Full progress with unbound total=0 fails safe as one Sprint', () => {
  const kickoff = nextStep({
    ...baseFull, state: 'SPEC_APPROVED', enabledRoles: fullRoles,
    sprint: { current: 0, total: 0 },
  });
  assert.equal(kickoff.next, 'SPRINT_1_KICKOFF');
  const finalOnly = nextStep({
    ...baseFull, state: 'SPRINT_1_DEV_DONE', enabledRoles: fullRoles,
    sprint: { current: 1, total: 0 }, workflow: { sprint_delivery: 'final_only' },
  });
  assert.equal(finalOnly.next, 'ALL_SPRINTS_DEV_DONE');
  const perSprint = nextStep({
    ...baseFull, state: 'SPRINT_1_DONE', enabledRoles: fullRoles,
    sprint: { current: 1, total: 0 }, workflow: { sprint_delivery: 'per_sprint' },
  });
  assert.equal(perSprint.next, 'ALL_SPRINTS_DONE');
});

test('full final-only mode: all development sprints enter one integration review', () => {
  const r = nextStep({
    ...baseFull,
    state: 'ALL_SPRINTS_DEV_DONE',
    enabledRoles: fullRoles,
    workflow: { sprint_delivery: 'final_only' },
  });
  assert.deepEqual(r, { next: 'INTEGRATION_REVIEW', role: 'sa', action: 'review_integration' });
});

test('full final-only mode: document sync and review fixes run before fresh code review', () => {
  const workflow = { sprint_delivery: 'final_only' };
  const docSync = nextStep({
    ...baseFull,
    state: 'SPRINT_1_DOC_SYNC',
    enabledRoles: fullRoles,
    workflow,
  });
  assert.deepEqual(docSync, {
    next: 'SPRINT_1_DOC_SYNC_DONE', role: 'tech-lead', action: 'sync_docs', sprint: 1,
  });
  const reviewAfterDocs = nextStep({
    ...baseFull,
    state: 'SPRINT_1_DOC_SYNC_DONE',
    enabledRoles: fullRoles,
    workflow,
  });
  assert.deepEqual(reviewAfterDocs, {
    next: 'SPRINT_1_SA_CODE', role: 'sa', action: 'review_code', sprint: 1,
  });
  const fix = nextStep({
    ...baseFull,
    state: 'SPRINT_1_FIX',
    enabledRoles: fullRoles,
    workflow,
  });
  assert.deepEqual(fix, {
    next: 'SPRINT_1_FIX_DONE', role: 'tech-lead', action: 'revise_implementation', sprint: 1,
  });
  const reviewAfterFix = nextStep({
    ...baseFull,
    state: 'SPRINT_1_FIX_DONE',
    enabledRoles: fullRoles,
    workflow,
  });
  assert.deepEqual(reviewAfterFix, {
    next: 'SPRINT_1_SA_CODE', role: 'sa', action: 'review_code', sprint: 1,
  });
});

test('full final-only mode: integration and final-fix revisions always get a fresh review', () => {
  const integrationFix = nextStep({
    ...baseFull,
    state: 'INTEGRATION_REVIEW_NEEDS_REVISION',
    enabledRoles: fullRoles,
  });
  assert.deepEqual(integrationFix, {
    next: 'INTEGRATION_FIX', role: 'tech-lead', action: 'revise_integration',
  });
  const integrationReview = nextStep({
    ...baseFull,
    state: 'INTEGRATION_FIX',
    enabledRoles: fullRoles,
  });
  assert.deepEqual(integrationReview, {
    next: 'INTEGRATION_REVIEW', role: 'sa', action: 'review_integration',
  });
  const finalFix = nextStep({
    ...baseFull,
    state: 'FINAL_FIX_REVIEW_NEEDS_REVISION',
    enabledRoles: fullRoles,
  });
  assert.deepEqual(finalFix, {
    next: 'FINAL_FIX', role: 'tech-lead', action: 'revise_implementation',
  });
});

test('full final-only mode: automatic test release dispatches once then runs final QA', () => {
  const pending = nextStep({
    ...baseFull,
    state: 'TEST_RELEASE',
    enabledRoles: fullRoles,
    workflow: {
      sprint_delivery: 'final_only',
      g2_enabled: true,
      test_release: { policy: 'auto_if_ready', status: 'idle', attempt: 0 },
    },
  });
  assert.deepEqual(pending, { next: 'TEST_RELEASE', role: null, action: 'release_test' });

  const deployed = nextStep({
    ...baseFull,
    state: 'TEST_RELEASE',
    enabledRoles: fullRoles,
    workflow: {
      sprint_delivery: 'final_only',
      g2_enabled: true,
      test_release: { policy: 'auto_if_ready', status: 'succeeded', attempt: 1 },
    },
  });
  assert.deepEqual(deployed, { next: 'FINAL_QA', role: 'qa', action: 'run_final' });
});

test('full final-only mode: a deployed fix is reviewed and released before regression', () => {
  const fix = nextStep({ ...baseFull, state: 'FINAL_QA_BLOCKED', enabledRoles: fullRoles });
  assert.deepEqual(fix, { next: 'FINAL_FIX', role: 'tech-lead', action: 'fix_bug' });
  const review = nextStep({ ...baseFull, state: 'FINAL_FIX', enabledRoles: fullRoles });
  assert.deepEqual(review, { next: 'FINAL_FIX_REVIEW', role: 'sa', action: 'review_final_fix' });
});

test('full final-only mode: release attempt two dispatches deployed regression', () => {
  const r = nextStep({
    ...baseFull,
    state: 'TEST_RELEASE',
    enabledRoles: fullRoles,
    workflow: {
      sprint_delivery: 'final_only',
      test_release: { policy: 'auto_if_ready', status: 'succeeded', attempt: 2 },
    },
  });
  assert.deepEqual(r, { next: 'FINAL_QA', role: 'qa', action: 'regression_final' });
});

test('full final-only mode: rejected final acceptance returns to integration fix', () => {
  const r = nextStep({
    ...baseFull,
    state: 'FINAL_ACCEPTANCE_REJECTED',
    enabledRoles: fullRoles,
    workflow: { sprint_delivery: 'final_only' },
  });
  assert.deepEqual(r, { next: 'INTEGRATION_FIX', role: 'tech-lead', action: 'revise_integration' });
});

test('full mode: high counters do not hijack test release or COMPLETE', () => {
  const counters = {
    review_revision: 9,
    evaluator_reject: 9,
    fix_per_bug: { 'BUG-001': 9 },
  };
  const release = nextStep({
    ...baseFull,
    state: 'TEST_RELEASE',
    counters,
    enabledRoles: fullRoles,
    workflow: { test_release: { policy: 'auto_if_ready', status: 'idle', attempt: 0 } },
  });
  assert.deepEqual(release, { next: 'TEST_RELEASE', role: null, action: 'release_test' });

  const complete = nextStep({ ...baseFull, state: 'COMPLETE', counters, enabledRoles: fullRoles });
  assert.deepEqual(complete, { next: 'COMPLETE', role: null, action: 'noop' });
});

test('full mode: review circuit breaker only applies in a review revision state', () => {
  const r = nextStep({
    ...baseFull,
    state: 'INTEGRATION_REVIEW_NEEDS_REVISION',
    counters: { review_revision: 3, evaluator_reject: 0, fix_per_bug: {} },
    enabledRoles: fullRoles,
  });
  assert.equal(r.circuitBreaker, 'review');
  assert.equal(r.next, 'SPEC_REVIEWING');
});

test('full mode: evaluator and bug-fix breakers still apply in their own failure states', () => {
  const evaluator = nextStep({
    ...baseFull,
    state: 'FINAL_ACCEPTANCE_REJECTED',
    counters: { review_revision: 0, evaluator_reject: 2, fix_per_bug: {} },
    enabledRoles: fullRoles,
  });
  assert.equal(evaluator.circuitBreaker, 'evaluator');

  const fix = nextStep({
    ...baseFull,
    state: 'FINAL_QA_BLOCKED',
    counters: { review_revision: 0, evaluator_reject: 0, fix_per_bug: { 'BUG-001': 3 } },
    enabledRoles: fullRoles,
  });
  assert.equal(fix.circuitBreaker, 'fix');
  assert.equal(fix.bug, 'BUG-001');
});

// --- fast mode ---

test('unspecified mode defaults to fast', () => {
  const r = nextStep({
    state: 'REQ_DRAFTED',
    enabledRoles: ['fullstack', 'reviewer', 'verifier'],
  });
  assert.equal(r.next, 'SPEC_DRAFTED');
  assert.equal(r.role, 'fullstack');
});

test('fast mode supports minimal developer/reviewer role set', () => {
  const draft = nextStep({ state: 'REQ_DRAFTED', enabledRoles: ['planner', 'developer', 'reviewer'] });
  const verify = nextStep({ state: 'DEPLOY_GATE', enabledRoles: ['planner', 'developer', 'reviewer'], workflow: { g2_enabled: false } });
  assert.equal(draft.role, 'developer');
  assert.equal(verify.role, 'reviewer');
});

test('fast mode: REQ_DRAFTED → SPEC_DRAFTED with fullstack', () => {
  const r = nextStep({
    state: 'REQ_DRAFTED',
    counters: { review_revision: 0, fix_per_bug: {}, evaluator_reject: 0 },
    thresholds: { review_revision: 2, fix_per_bug: 2, evaluator_reject: 2 },
    enabledRoles: ['fullstack', 'reviewer', 'verifier'],
    humanGateApproved: false,
    mode: 'fast',
  });
  assert.equal(r.next, 'SPEC_DRAFTED');
  assert.equal(r.role, 'fullstack');
  assert.equal(r.action, 'draft_spec');
});

test('fast and legacy lite implementation dispatches carry repository fanout metadata', () => {
  for (const mode of ['fast', 'lite']) {
    const result = nextStep({
      state: 'SPEC_APPROVED', mode,
      enabledRoles: ['fullstack', 'reviewer', 'verifier'],
    });
    assert.deepEqual(result, {
      next: 'BUILD', role: 'fullstack', action: 'implement', fanout: 'implementation_repositories',
    });
  }
});

test('fast mode: automatic test release falls back to the manual gate when prerequisites are missing', () => {
  const r = nextStep({
    state: 'TEST_RELEASE',
    enabledRoles: ['fullstack', 'reviewer', 'verifier'],
    mode: 'fast',
    workflow: {
      g2_enabled: true,
      test_release: { policy: 'auto_if_ready', status: 'idle', prerequisites_met: false },
    },
  });
  assert.equal(r.stop, true);
  assert.equal(r.action, 'await_deploy_approval');
});

test('fast mode: approved legacy deploy gate dispatches verification', () => {
  const r = nextStep({
    state: 'DEPLOY_GATE',
    enabledRoles: ['fullstack', 'reviewer', 'verifier'],
    mode: 'fast',
    workflow: { g2_enabled: true, g2_approved: true },
  });
  assert.deepEqual(r, { next: 'TEST', role: 'verifier', action: 'verify_initial' });
});

test('fast mode: disabled release policy skips release while keeping G2 semantics independent', () => {
  const policyDisabled = nextStep({
    state: 'TEST_RELEASE',
    enabledRoles: ['fullstack', 'reviewer', 'verifier'],
    mode: 'fast',
    workflow: { g2_enabled: true, test_release: { policy: 'disabled', status: 'idle' } },
  });
  assert.deepEqual(policyDisabled, { next: 'TEST', role: 'verifier', action: 'verify_initial' });

  const g2Disabled = nextStep({
    state: 'TEST_RELEASE',
    enabledRoles: ['fullstack', 'reviewer', 'verifier'],
    mode: 'fast',
    workflow: { g2_enabled: false, test_release: { policy: 'auto_if_ready', status: 'idle' } },
  });
  assert.deepEqual(g2Disabled, { next: 'TEST', role: 'verifier', action: 'verify_initial' });
});

test('fast mode: COMPLETE is terminal even when every circuit counter is high', () => {
  const r = nextStep({
    state: 'COMPLETE',
    counters: { review_revision: 9, evaluator_reject: 9, fix_per_bug: { 'BUG-001': 9 } },
    thresholds: { review_revision: 2, fix_per_bug: 2, evaluator_reject: 2 },
    enabledRoles: ['fullstack', 'reviewer', 'verifier'],
    mode: 'fast',
  });
  assert.deepEqual(r, { next: 'COMPLETE', role: null, action: 'noop' });
});

test('fast mode: each circuit breaker still applies in its matching failure state', () => {
  const thresholds = { review_revision: 2, fix_per_bug: 2, evaluator_reject: 2 };
  const common = {
    thresholds,
    enabledRoles: ['fullstack', 'reviewer', 'verifier'],
    mode: 'fast',
  };
  const review = nextStep({
    ...common,
    state: 'CODE_REVIEW_NEEDS_REVISION',
    counters: { review_revision: 2, evaluator_reject: 0, fix_per_bug: {} },
  });
  assert.equal(review.circuitBreaker, 'review');

  const evaluator = nextStep({
    ...common,
    state: 'ACCEPTANCE_REJECTED',
    counters: { review_revision: 0, evaluator_reject: 2, fix_per_bug: {} },
  });
  assert.equal(evaluator.circuitBreaker, 'evaluator');

  const fix = nextStep({
    ...common,
    state: 'FIX',
    counters: { review_revision: 0, evaluator_reject: 0, fix_per_bug: { 'BUG-001': 2 } },
  });
  assert.equal(fix.circuitBreaker, 'fix');
  assert.equal(fix.stop, true);
});

test('fast mode: fixes must be reviewed before another test release', () => {
  const r = nextStep({ state: 'FIX', enabledRoles: ['fullstack', 'reviewer', 'verifier'], mode: 'fast' });
  assert.deepEqual(r, { next: 'FIX_REVIEW', role: 'reviewer', action: 'review_code' });
});

test('fast mode: rejected fix review returns to implementation before another review', () => {
  const r = nextStep({
    state: 'FIX_REVIEW_NEEDS_REVISION',
    enabledRoles: ['fullstack', 'reviewer', 'verifier'],
    mode: 'fast',
  });
  assert.deepEqual(r, { next: 'FIX', role: 'fullstack', action: 'revise_implementation' });
});

test('fast mode: second successful release can only dispatch regression', () => {
  const r = nextStep({
    state: 'TEST_RELEASE',
    enabledRoles: ['fullstack', 'reviewer', 'verifier'],
    mode: 'fast',
    workflow: { test_release: { policy: 'auto_if_ready', status: 'succeeded', attempt: 2 } },
  });
  assert.deepEqual(r, { next: 'REGRESSION', role: 'verifier', action: 'verify_regression' });
});

const leanRoles = ['lean-planner', 'lean-developer', 'lean-reviewer', 'lean-verifier'];

test('lean mode: plan is the first role call and pauses at the plan gate', () => {
  const planning = nextStep({ state: 'INIT', enabledRoles: leanRoles, mode: 'lean' });
  assert.deepEqual(planning, { next: 'PLANNING', role: 'lean-planner', action: 'draft_plan' });
  const gate = nextStep({ state: 'PLANNING', enabledRoles: leanRoles, mode: 'lean' });
  assert.equal(gate.next, 'PLAN_PENDING_HUMAN');
  assert.equal(gate.stop, true);
});

test('lean mode: approved plan executes, verifies locally, then performs one consolidated review', () => {
  const approved = nextStep({
    state: 'PLAN_PENDING_HUMAN', enabledRoles: leanRoles, mode: 'lean', workflow: { plan_approved: true },
  });
  assert.equal(approved.next, 'PLAN_APPROVED');
  assert.deepEqual(nextStep({ state: 'PLAN_APPROVED', enabledRoles: leanRoles, mode: 'lean' }), {
    next: 'IMPLEMENTING', role: 'lean-developer', action: 'execute_plan',
  });
  assert.deepEqual(nextStep({ state: 'IMPLEMENTING', enabledRoles: leanRoles, mode: 'lean' }), {
    next: 'LOCAL_VERIFYING', role: null, action: 'verify_local',
  });
  assert.deepEqual(nextStep({ state: 'LOCAL_VERIFYING', enabledRoles: leanRoles, mode: 'lean' }), {
    next: 'CONSOLIDATED_REVIEW', role: 'lean-reviewer', action: 'review_candidate',
  });
});

test('lean mode: fast-track reaches test before consolidated Review and still reviews before Gateway B', () => {
  const workflow = {
    delivery_lane: 'fast-track',
    review: { status: 'idle' },
    test_release: { policy: 'auto_if_ready', status: 'idle', attempt: 0 },
  };
  assert.deepEqual(nextStep({ state: 'LOCAL_VERIFYING', enabledRoles: leanRoles, mode: 'lean', workflow }), {
    next: 'CANDIDATE_READY', role: null, action: 'continue_to_test',
  });
  assert.deepEqual(nextStep({ state: 'CANDIDATE_READY', enabledRoles: leanRoles, mode: 'lean', workflow }), {
    next: 'TEST_RELEASE', role: null, action: 'continue',
  });
  assert.deepEqual(nextStep({
    state: 'TEST_VERIFIED', enabledRoles: leanRoles, mode: 'lean', workflow: { ...workflow, test_release: { status: 'verified' } },
  }), {
    next: 'CONSOLIDATED_REVIEW', role: 'lean-reviewer', action: 'review_tested_candidate',
  });
  const gate = nextStep({
    state: 'CANDIDATE_READY',
    enabledRoles: leanRoles,
    mode: 'lean',
    workflow: { delivery_lane: 'fast-track', review: { status: 'passed' }, test_release: { status: 'verified' } },
  });
  assert.equal(gate.next, 'RELEASE_PENDING_HUMAN');
  assert.equal(gate.stop, true);
});

test('lean mode: fast-track environment-only local deferral and test fixes do not force a premature delta Review', () => {
  const result = nextStep({
    state: 'LOCAL_REVERIFYING',
    enabledRoles: leanRoles,
    mode: 'lean',
    workflow: {
      delivery_lane: 'fast-track',
      review: { status: 'idle' },
      local_verification: { context: 'test' },
    },
  });
  assert.deepEqual(result, { next: 'CANDIDATE_READY', role: null, action: 'continue_to_test' });
});

test('lean mode: review findings are fixed once and closed against the delta', () => {
  assert.deepEqual(nextStep({ state: 'CONSOLIDATED_REVIEW_BLOCKED', enabledRoles: leanRoles, mode: 'lean' }), {
    next: 'REVIEW_FIXING', role: 'lean-developer', action: 'fix_review',
  });
  assert.deepEqual(nextStep({ state: 'LOCAL_REVERIFYING', enabledRoles: leanRoles, mode: 'lean' }), {
    next: 'REVIEW_CLOSURE', role: 'lean-reviewer', action: 'review_delta',
  });
  const stopped = nextStep({ state: 'REVIEW_CLOSURE_BLOCKED', enabledRoles: leanRoles, mode: 'lean' });
  assert.equal(stopped.next, 'HUMAN_INTERVENTION');
  assert.equal(stopped.stop, true);
});

test('lean mode: recorded exact Review survives a crash before the state transition', () => {
  assert.deepEqual(nextStep({
    state: 'LOCAL_VERIFYING', enabledRoles: leanRoles, mode: 'lean',
    workflow: { review: { status: 'passed', exact: true } },
  }), { next: 'CONSOLIDATED_REVIEW', role: null, action: 'continue' });
  assert.deepEqual(nextStep({
    state: 'TEST_VERIFIED', enabledRoles: leanRoles, mode: 'lean',
    workflow: { delivery_lane: 'fast-track', review: { status: 'passed', exact: true } },
  }), { next: 'RELEASE_PENDING_HUMAN', role: null, action: 'await_release_approval', stop: true });
  assert.deepEqual(nextStep({
    state: 'TEST_VERIFIED', enabledRoles: leanRoles, mode: 'lean',
    workflow: { delivery_lane: 'fast-track', review: { status: 'passed', exact: false } },
  }), { next: 'CONSOLIDATED_REVIEW', role: 'lean-reviewer', action: 'review_tested_candidate' });
  assert.deepEqual(nextStep({
    state: 'LOCAL_REVERIFYING', enabledRoles: leanRoles, mode: 'lean',
    workflow: { review: { status: 'passed', exact: true, closure_attempts: 1 } },
  }), { next: 'REVIEW_CLOSURE', role: null, action: 'continue' });
  assert.deepEqual(nextStep({
    state: 'GATEWAY_B_LOCAL_REVERIFYING', enabledRoles: leanRoles, mode: 'lean',
    workflow: { review: { status: 'passed', exact: true, gateway_b_delta_attempts: 1 } },
  }), { next: 'GATEWAY_B_DELTA_REVIEW', role: null, action: 'continue' });
});

test('lean mode: local reverify failures return to the originating repair path', () => {
  const review = nextStep({
    state: 'LOCAL_REVERIFY_FAILED', enabledRoles: leanRoles, mode: 'lean',
    workflow: { local_verification: { context: 'review' } },
  });
  assert.equal(review.next, 'REVIEW_FIXING');

  const testFix = nextStep({
    state: 'LOCAL_REVERIFY_FAILED', enabledRoles: leanRoles, mode: 'lean',
    workflow: { local_verification: { context: 'test' } },
  });
  assert.equal(testFix.next, 'TEST_FIXING');

  const gateway = nextStep({
    state: 'LOCAL_REVERIFY_FAILED', enabledRoles: leanRoles, mode: 'lean',
    workflow: { local_verification: { context: 'gateway_b' } },
  });
  assert.equal(gateway.next, 'GATEWAY_B_FIXING');
});

test('lean mode: verified test release pauses at release gate then merges base', () => {
  const verified = nextStep({ state: 'TEST_VERIFIED', enabledRoles: leanRoles, mode: 'lean' });
  assert.equal(verified.next, 'RELEASE_PENDING_HUMAN');
  assert.equal(verified.stop, true);
  const merge = nextStep({
    state: 'RELEASE_PENDING_HUMAN', enabledRoles: leanRoles, mode: 'lean', workflow: { release_approved: true },
  });
  assert.deepEqual(merge, { next: 'BASE_MERGING', role: null, action: 'release_base' });
  assert.deepEqual(nextStep({
    state: 'BASE_MERGING', enabledRoles: leanRoles, mode: 'lean',
    workflow: { base_release: { status: 'idle' } },
  }), { next: 'BASE_MERGING', role: null, action: 'release_base' });
  assert.deepEqual(nextStep({
    state: 'BASE_MERGING', enabledRoles: leanRoles, mode: 'lean',
    workflow: { base_release: { status: 'succeeded' } },
  }), { next: 'COMPLETE', role: null, action: 'complete' });
  assert.deepEqual(nextStep({
    state: 'BASE_MERGING', enabledRoles: leanRoles, mode: 'lean',
    workflow: { base_release: { status: 'failed' } },
  }), { next: 'BASE_MERGE_BLOCKED', role: null, action: 'await_human', stop: true });
});

test('lean mode: candidate enters TEST_RELEASE before invoking the controller', () => {
  assert.deepEqual(nextStep({ state: 'CANDIDATE_READY', enabledRoles: leanRoles, mode: 'lean' }), {
    next: 'TEST_RELEASE', role: null, action: 'continue',
  });
  assert.equal(nextStep({
    state: 'TEST_RELEASE', enabledRoles: leanRoles, mode: 'lean',
    workflow: { test_release: { policy: 'auto_if_ready', status: 'idle' } },
  }).action, 'release_test');
});

test('lean mode: legacy G2 alone never impersonates an immutable test release attempt', () => {
  assert.deepEqual(nextStep({
    state: 'TEST_RELEASE', enabledRoles: leanRoles, mode: 'lean',
    workflow: { g2_approved: true, test_release: { policy: 'manual', status: 'idle' } },
  }), { next: 'TEST_RELEASE', role: null, action: 'configure_auto_test_release', stop: true });
});

test('lean mode: a deploying CI attempt resumes without another test merge', () => {
  assert.deepEqual(nextStep({
    state: 'TEST_RELEASE', enabledRoles: leanRoles, mode: 'lean',
    workflow: { test_release: { policy: 'auto_if_ready', status: 'deploying' } },
  }), { next: 'TEST_RELEASE', role: null, action: 'poll_test_release' });
});

test('lean mode: unavailable browser after deployment becomes a resumable manual verification state', () => {
  const manual = nextStep({
    state: 'TEST_VERIFYING',
    enabledRoles: leanRoles,
    mode: 'lean',
    workflow: { test_release: { status: 'deployed_needs_manual_verification' } },
  });
  assert.equal(manual.next, 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY');
  assert.equal(manual.stop, true);

  const resumed = nextStep({
    state: 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY',
    enabledRoles: leanRoles,
    mode: 'lean',
    workflow: { test_release: { status: 'verified' } },
  });
  assert.deepEqual(resumed, { next: 'TEST_VERIFIED', role: null, action: 'continue' });

  const failed = nextStep({
    state: 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY',
    enabledRoles: leanRoles,
    mode: 'lean',
    workflow: { test_release: { status: 'failed' } },
  });
  assert.deepEqual(failed, { next: 'TEST_VERIFY_FAILED', role: null, action: 'continue' });
});

test('lean mode: a recorded verification resumes idempotently after an orchestrator crash', () => {
  assert.deepEqual(nextStep({
    state: 'TEST_RELEASE',
    enabledRoles: leanRoles,
    mode: 'lean',
    workflow: { test_release: { policy: 'auto_if_ready', status: 'verified', attempt: 1 } },
  }), { next: 'TEST_VERIFIED', role: null, action: 'continue' });
});

test('lean mode: Gateway B implementation feedback uses one delta review before a new test release', () => {
  assert.deepEqual(nextStep({ state: 'GATEWAY_B_CHANGE_REQUESTED', enabledRoles: leanRoles, mode: 'lean' }), {
    next: 'GATEWAY_B_FIXING', role: 'lean-developer', action: 'fix_gateway_b_feedback',
  });
  assert.deepEqual(nextStep({ state: 'GATEWAY_B_FIXING', enabledRoles: leanRoles, mode: 'lean' }), {
    next: 'GATEWAY_B_LOCAL_REVERIFYING', role: null, action: 'verify_local',
  });
  assert.deepEqual(nextStep({ state: 'GATEWAY_B_LOCAL_REVERIFYING', enabledRoles: leanRoles, mode: 'lean' }), {
    next: 'GATEWAY_B_DELTA_REVIEW', role: 'lean-reviewer', action: 'review_gateway_b_delta',
  });
  const blocked = nextStep({ state: 'GATEWAY_B_DELTA_REVIEW_BLOCKED', enabledRoles: leanRoles, mode: 'lean' });
  assert.equal(blocked.next, 'HUMAN_INTERVENTION');
  assert.equal(blocked.stop, true);
});

test('lean mode: Gateway B scope feedback returns to Planner and Gateway A', () => {
  assert.deepEqual(nextStep({ state: 'SCOPE_CHANGE_REQUESTED', enabledRoles: leanRoles, mode: 'lean' }), {
    next: 'PLANNING', role: 'lean-planner', action: 'revise_plan_for_gateway_b',
  });
  const gate = nextStep({ state: 'PLANNING', enabledRoles: leanRoles, mode: 'lean' });
  assert.equal(gate.next, 'PLAN_PENDING_HUMAN');
});

const hotfixRoles = ['hotfix-developer', 'hotfix-reviewer', 'hotfix-verifier'];

test('hotfix mode: independently bound scope starts implementation and P3 skips only model Review', () => {
  const init = nextStep({ state: 'INIT', enabledRoles: hotfixRoles, mode: 'hotfix' });
  assert.equal(init.action, 'bind_hotfix_scope');
  assert.equal(init.stop, true);
  assert.deepEqual(nextStep({ state: 'HOTFIX_IMPLEMENTING', enabledRoles: hotfixRoles, mode: 'hotfix' }), {
    next: 'HOTFIX_IMPLEMENTED', role: 'hotfix-developer', action: 'implement_hotfix',
  });
  assert.deepEqual(nextStep({ state: 'HOTFIX_IMPLEMENTED', enabledRoles: hotfixRoles, mode: 'hotfix' }), {
    next: 'HOTFIX_LOCAL_VERIFYING', role: null, action: 'verify_local',
  });
  assert.deepEqual(nextStep({
    state: 'HOTFIX_LOCAL_VERIFYING', enabledRoles: hotfixRoles, mode: 'hotfix', workflow: { hotfix: { severity: 'P3' } },
  }), { next: 'HOTFIX_CANDIDATE_READY', role: null, action: 'assert_p3_candidate' });
  assert.deepEqual(nextStep({
    state: 'HOTFIX_LOCAL_VERIFYING', enabledRoles: hotfixRoles, mode: 'hotfix', workflow: { hotfix: { severity: 'P2' } },
  }), { next: 'HOTFIX_REVIEWING', role: 'hotfix-reviewer', action: 'review_hotfix' });
});

test('hotfix mode: one repair delta closes or stops for human intervention', () => {
  assert.deepEqual(nextStep({ state: 'HOTFIX_REVIEW_BLOCKED', enabledRoles: hotfixRoles, mode: 'hotfix' }), {
    next: 'HOTFIX_FIXING', role: 'hotfix-developer', action: 'fix_hotfix',
  });
  assert.deepEqual(nextStep({ state: 'HOTFIX_LOCAL_REVERIFYING', enabledRoles: hotfixRoles, mode: 'hotfix' }), {
    next: 'HOTFIX_DELTA_REVIEW', role: 'hotfix-reviewer', action: 'review_hotfix_delta',
  });
  assert.deepEqual(nextStep({
    state: 'HOTFIX_LOCAL_REVERIFYING', enabledRoles: hotfixRoles, mode: 'hotfix', workflow: { hotfix: { severity: 'P3' } },
  }), { next: 'HOTFIX_CANDIDATE_READY', role: null, action: 'assert_p3_candidate' });
  const stopped = nextStep({ state: 'HOTFIX_DELTA_REVIEW_BLOCKED', enabledRoles: hotfixRoles, mode: 'hotfix' });
  assert.equal(stopped.next, 'HUMAN_INTERVENTION');
  assert.equal(stopped.stop, true);
});

test('hotfix mode: test failure counter and consumed delta both stop repeated repair loops', () => {
  const firstFailure = nextStep({
    state: 'HOTFIX_TEST_FAILED', enabledRoles: hotfixRoles, mode: 'hotfix',
    counters: { review_revision: 0, evaluator_reject: 0, fix_per_bug: { HOTFIX_TEST: 1 } },
    thresholds: { review_revision: 1, evaluator_reject: 1, fix_per_bug: 1 },
    workflow: { hotfix: { severity: 'P3', delta_attempts: 0 } },
  });
  assert.equal(firstFailure.next, 'HOTFIX_FIXING');

  const repeatedFailure = nextStep({
    state: 'HOTFIX_TEST_FAILED', enabledRoles: hotfixRoles, mode: 'hotfix',
    counters: { review_revision: 0, evaluator_reject: 0, fix_per_bug: { HOTFIX_TEST: 2 } },
    thresholds: { review_revision: 1, evaluator_reject: 1, fix_per_bug: 1 },
    workflow: { hotfix: { severity: 'P3', delta_attempts: 0 } },
  });
  assert.equal(repeatedFailure.next, 'HUMAN_INTERVENTION');
  assert.equal(repeatedFailure.circuitBreaker, 'hotfix_fix');

  const consumedDelta = nextStep({
    state: 'HOTFIX_CHANGE_REQUESTED', enabledRoles: hotfixRoles, mode: 'hotfix',
    workflow: { hotfix: { severity: 'P2', delta_attempts: 1 } },
  });
  assert.equal(consumedDelta.next, 'HUMAN_INTERVENTION');
  assert.equal(consumedDelta.circuitBreaker, 'hotfix_delta');
});

test('hotfix mode: a P3 boundary violation stops in a named human state', () => {
  const result = nextStep({ state: 'HOTFIX_P3_BOUNDARY_BLOCKED', enabledRoles: hotfixRoles, mode: 'hotfix' });
  assert.equal(result.next, 'HUMAN_INTERVENTION');
  assert.equal(result.circuitBreaker, 'hotfix_boundary');
  assert.equal(result.stop, true);
});

test('hotfix mode: exact candidate goes test then pauses at Gateway B before base merge', () => {
  assert.deepEqual(nextStep({
    state: 'HOTFIX_CANDIDATE_READY', enabledRoles: hotfixRoles, mode: 'hotfix',
    workflow: { test_release: { policy: 'auto_if_ready', status: 'idle', attempt: 0 } },
  }), { next: 'HOTFIX_TEST_RELEASE', role: null, action: 'continue' });
  assert.deepEqual(nextStep({
    state: 'HOTFIX_TEST_RELEASE', enabledRoles: hotfixRoles, mode: 'hotfix',
    workflow: { test_release: { policy: 'auto_if_ready', status: 'idle', attempt: 0 } },
  }), { next: 'HOTFIX_TEST_RELEASE', role: null, action: 'release_test_hotfix' });
  assert.deepEqual(nextStep({
    state: 'HOTFIX_TEST_RELEASE', enabledRoles: hotfixRoles, mode: 'hotfix',
    workflow: { test_release: { policy: 'auto_if_ready', status: 'succeeded', attempt: 1 } },
  }), { next: 'HOTFIX_TEST_VERIFYING', role: 'hotfix-verifier', action: 'verify_hotfix_test' });
  const gate = nextStep({ state: 'HOTFIX_TEST_VERIFIED', enabledRoles: hotfixRoles, mode: 'hotfix' });
  assert.equal(gate.next, 'HOTFIX_RELEASE_PENDING_HUMAN');
  assert.equal(gate.stop, true);
  assert.deepEqual(nextStep({
    state: 'HOTFIX_RELEASE_PENDING_HUMAN', enabledRoles: hotfixRoles, mode: 'hotfix', workflow: { release_approved: true },
  }), { next: 'HOTFIX_BASE_MERGING', role: null, action: 'release_base' });
  assert.deepEqual(nextStep({
    state: 'HOTFIX_BASE_MERGING', enabledRoles: hotfixRoles, mode: 'hotfix',
    workflow: { base_release: { status: 'succeeded' } },
  }), { next: 'COMPLETE', role: null, action: 'complete' });
  assert.deepEqual(nextStep({
    state: 'HOTFIX_BASE_MERGING', enabledRoles: hotfixRoles, mode: 'hotfix',
    workflow: { base_release: { status: 'running' } },
  }), { next: 'HOTFIX_BASE_MERGE_BLOCKED', role: null, action: 'await_human', stop: true });
});
