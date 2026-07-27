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
