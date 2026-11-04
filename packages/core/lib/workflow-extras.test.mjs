import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createProgressV2, writeProgressV2 } from './progress-v2.mjs';

import { extractPlanDerivedBinding } from './plan-contract.mjs';
import { nextStep } from './state-machine.mjs';
import { computeTaskStats, workspaceStats } from './task-stats.mjs';
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

test('task stats count auto approvals, skipped plan reviews, Review rounds, findings, and test verdicts', () => {
  const at = new Date(Date.UTC(2026, 10, 1)).toISOString();
  let sequence = 0;
  const event = (type, data = {}, extra = {}) => ({ id: `e${++sequence}`, sequence, timestamp: at, type, data, ...extra });
  const counts = (blocking, unproven) => ({ finding_counts: { blocking, unproven, refuted: 0, advisory: 1, rejected: 0 } });
  const stats = computeTaskStats({
    created_at: at, updated_at: at,
    events: [
      event('plan.reviewed', { status: 'skipped' }),
      event('gate.approved', { gate: 'plan' }, { actor: 'auto-plan' }),
      event('review.consolidated_blocked', counts(1, 2)),
      event('review.closure_passed', counts(0, 0)),
      event('delivery.test.verification_blocked'),
      event('delivery.test.verification_passed'),
      event('gate.approved', { gate: 'release' }, { actor: 'Owner' }),
    ],
    delivery: { test: { attempts: [] }, base: { attempts: [] } },
  });
  assert.equal(stats.auto_approvals, 1);
  assert.deepEqual(stats.human_approvals, { release: 1 });
  assert.equal(stats.plan_reviews, 0);
  assert.equal(stats.plan_review_skips, 1);
  assert.deepEqual(stats.reviews, { consolidated: 1, closure: 1, gateway_b_delta: 0, blocked: 1 });
  assert.deepEqual(stats.findings, { blocking: 1, unproven: 2, refuted: 0, advisory: 2, rejected: 0 });
  assert.deepEqual(stats.test_verifications, { passed: 1, blocked: 1, manual_required: 0 });
});

test('workspace stats aggregate v2 tasks and skip feature worktrees and legacy files', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-stats-'));
  try {
    const write = (path, progress) => { mkdirSync(join(root, path), { recursive: true }); writeProgressV2(join(root, path, 'progress.json'), progress); };
    const lean = createProgressV2({ featureId: '01', featureSlug: 'one', preset: 'preset-standard', mode: 'lean', repositories: [] });
    lean.state = 'COMPLETE';
    write('all-docs/doc/01.one', lean);
    write('.worktrees/01-one/all-docs/doc/01.one', lean);
    write('.cc-nexs/hotfixes/fix-a', createProgressV2({ featureId: 'fix-a', featureSlug: 'fix-a', preset: 'preset-standard', mode: 'hotfix', repositories: [] }));
    mkdirSync(join(root, 'all-docs/doc/00.legacy'), { recursive: true });
    writeFileSync(join(root, 'all-docs/doc/00.legacy/progress.json'), '{"current_state":"DONE"}');
    const result = workspaceStats({ cwd: root });
    assert.equal(result.summary.tasks, 2);
    assert.equal(result.summary.completed, 1);
    assert.equal(result.skipped, 1);
    assert.equal(workspaceStats({ cwd: root, since: '2999-01-01' }).summary.tasks, 0);
    assert.throws(() => workspaceStats({ cwd: root, since: 'soon' }), /--since must be a date/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
