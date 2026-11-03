import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractPlanDerivedBinding } from './plan-contract.mjs';
import { nextStep } from './state-machine.mjs';
import { computeTaskStats } from './task-stats.mjs';
import { postReleaseItems } from './workflow-snapshot.mjs';

const leanRoles = ['lean-planner', 'lean-plan-reviewer', 'lean-developer', 'lean-reviewer', 'lean-verifier'];

test('derived_binding accepts before-final-test, defaults to each candidate, and rejects anything else', () => {
  assert.equal(extractPlanDerivedBinding('- derived_binding: before-final-test\n'), 'before-final-test');
  assert.equal(extractPlanDerivedBinding('- derived_binding: each-candidate\n'), null);
  assert.equal(extractPlanDerivedBinding('- delivery_lane: standard\n'), null);
  assert.throws(() => extractPlanDerivedBinding('- derived_binding: later\n'), /before-final-test or each-candidate/);
  assert.throws(() => extractPlanDerivedBinding('- derived_binding: before-final-test\n- derived_binding: each-candidate\n'), /at most one/);
});

test('a pending derived binding sends a verified candidate to one bind round in both lanes', () => {
  for (const lane of ['standard', 'fast-track']) {
    const workflow = { delivery_lane: lane, test_release: { status: 'verified' }, review: { status: 'passed', exact: true }, derived_binding: { status: 'pending' } };
    assert.deepEqual(nextStep({ state: 'TEST_VERIFIED', enabledRoles: leanRoles, mode: 'lean', workflow }), { next: 'TEST_FIXING', role: 'lean-developer', action: 'bind_derived' });
    const bound = { ...workflow, derived_binding: { status: 'bound' } };
    assert.notEqual(nextStep({ state: 'TEST_VERIFIED', enabledRoles: leanRoles, mode: 'lean', workflow: bound }).action, 'bind_derived');
  }
  const ready = { delivery_lane: 'fast-track', test_release: { status: 'verified' }, review: { status: 'passed', exact: true } };
  assert.equal(nextStep({ state: 'CANDIDATE_READY', enabledRoles: leanRoles, mode: 'lean', workflow: { ...ready, derived_binding: { status: 'pending' } } }).next, 'TEST_RELEASE');
  assert.equal(nextStep({ state: 'CANDIDATE_READY', enabledRoles: leanRoles, mode: 'lean', workflow: ready }).next, 'RELEASE_PENDING_HUMAN');
});

test('post-release items are read from the plan section in any template language', () => {
  for (const heading of ['## Post-release', '## 上线后事项', '## 上線後事項']) {
    const items = postReleaseItems(`# Plan\n${heading}\n- [ ] Deploy production\n- [x] Notify support\n- not a checklist\n## Plan Changes\n- [ ] ignored\n`);
    assert.deepEqual(items, [{ done: false, text: 'Deploy production' }, { done: true, text: 'Notify support' }]);
  }
  assert.deepEqual(postReleaseItems('# Plan\n## Risks\n- [ ] not post-release\n'), []);
});

test('task stats separate active time, conflicts, deploy waits and human approvals', () => {
  const t = (minutes) => new Date(Date.UTC(2026, 10, 1, 8, 0) + minutes * 60000).toISOString();
  let sequence = 0;
  const event = (minutes, type, data = {}, extra = {}) => ({ id: `e${++sequence}`, sequence, timestamp: t(minutes), type, data, ...extra });
  const progress = {
    created_at: t(0), updated_at: t(600),
    events: [
      event(0, 'gate.approved', { gate: 'plan' }),
      event(10, 'delivery.test.started', { attempt: 'test-release-1' }),
      event(11, 'delivery.test.merge_conflict', { attempt: 'test-release-1' }),
      event(41, 'delivery.test.merge_conflict_resolved', { attempt: 'test-release-1' }),
      event(42, 'delivery.test.awaiting_receipt', { attempt: 'test-release-1' }),
      event(57, 'delivery.test.succeeded', { attempt: 'test-release-1' }),
      event(500, 'gate.approved', { gate: 'release' }),
      event(510, 'local_verification.failed'),
    ],
    delivery: { test: { attempts: [{ id: 'test-release-1', deployment: { environment: 'test' }, environment_revision: { api: 'a' } }] }, base: { attempts: [] } },
  };
  const stats = computeTaskStats(progress);
  assert.equal(stats.elapsed_minutes, 600);
  assert.equal(stats.active_minutes, 67);
  assert.deepEqual(stats.human_approvals, { plan: 1, release: 1 });
  assert.equal(stats.test_conflict_attempts, 1);
  assert.equal(stats.conflict_minutes, 30);
  assert.equal(stats.deploy_wait_minutes, 15);
  assert.equal(stats.test_deployments, 1);
  assert.deepEqual(stats.local_verifications, { passed: 0, failed: 1 });
});
