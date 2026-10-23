// Smoke tests for state-machine.
// Run: npm run test:hooks

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStep } from './state-machine.mjs';

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

test('hotfix mode: independently bound scope starts implementation and P3 also requires independent Review', () => {
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
  }), { next: 'HOTFIX_REVIEWING', role: 'hotfix-reviewer', action: 'review_hotfix' });
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
  }), { next: 'HOTFIX_DELTA_REVIEW', role: 'hotfix-reviewer', action: 'review_hotfix_delta' });
  const stopped = nextStep({ state: 'HOTFIX_DELTA_REVIEW_BLOCKED', enabledRoles: hotfixRoles, mode: 'hotfix' });
  assert.equal(stopped.next, 'HUMAN_INTERVENTION');
  assert.equal(stopped.stop, true);
});

test('hotfix mode: test failure counter and consumed delta both stop repeated repair loops', () => {
  const firstFailure = nextStep({
    state: 'HOTFIX_TEST_FAILED', enabledRoles: hotfixRoles, mode: 'hotfix',
    counters: { review_revision: 0, fix_per_bug: { HOTFIX_TEST: 1 } },
    thresholds: { review_revision: 1, fix_per_bug: 1 },
    workflow: { hotfix: { severity: 'P3', delta_attempts: 0 } },
  });
  assert.equal(firstFailure.next, 'HOTFIX_FIXING');

  const repeatedFailure = nextStep({
    state: 'HOTFIX_TEST_FAILED', enabledRoles: hotfixRoles, mode: 'hotfix',
    counters: { review_revision: 0, fix_per_bug: { HOTFIX_TEST: 2 } },
    thresholds: { review_revision: 1, fix_per_bug: 1 },
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
  }), { next: 'HOTFIX_BASE_MERGING', role: null, action: 'release_base' });
});

test('base changes dispatch automatic development-branch repair without a human stop', () => {
  for (const [mode, state, next, role] of [
    ['lean', 'BASE_CHANGED', 'IMPLEMENTING', 'lean-developer'],
    ['hotfix', 'HOTFIX_BASE_CHANGED', 'HOTFIX_FIXING', 'hotfix-developer'],
  ]) {
    assert.deepEqual(nextStep({ mode, state, workflow: {}, counters: {}, enabledRoles: [role] }), { next, role, action: 'sync_base' });
  }
});

for (const [mode, role] of [['lean', 'lean-developer'], ['hotfix', 'hotfix-developer']]) {
  test(`${mode} test conflict dispatches Developer without a human gate`, () => {
    const state = mode === 'hotfix' ? 'HOTFIX_TEST_MERGE_CONFLICT' : 'TEST_MERGE_CONFLICT';
    assert.deepEqual(nextStep({ mode, state, enabledRoles: [role] }), { next: state, role, action: 'resolve_test_conflict' });
  });
}

test('removed Fast and Full modes are rejected', () => {
  for (const mode of ['fast', 'full', 'lite']) {
    assert.throws(() => nextStep({ mode, state: 'INIT', enabledRoles: [] }), /unsupported mode/);
  }
});
