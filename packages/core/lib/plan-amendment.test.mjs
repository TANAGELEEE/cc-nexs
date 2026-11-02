import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { runCcNexsCommand } from './cc-nexs-cli.mjs';
import { requestPlanAmendment, reviewPlanAmendment } from './plan-amendment.mjs';
import { assertPlanApprovalCurrent, planApprovalBinding, PLAN_SCOPE_MARKERS } from './plan-contract.mjs';
import { createProgressV2, readProgressV2, recordReleaseChangeRequest, writeProgressV2 } from './progress-v2.mjs';
import { deliveryMilestones } from './workflow-snapshot.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const PLAN = [
  '# Plan',
  PLAN_SCOPE_MARKERS.START,
  '- risk_tier: medium',
  '- delivery_lane: fast-track',
  '| T-001 | AC-001 | api | src/a.ts | None | LV-001 | W1 |',
  PLAN_SCOPE_MARKERS.END,
  '',
  '## Plan Changes',
  '',
  '| Date | Change | Affects approved scope | Action |',
  '|---|---|---|---|',
  '',
  '## Gateway B Change Request',
  '',
].join('\n');

function createApprovedFeature(state = 'TEST_VERIFY_FAILED', plan = PLAN) {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-amend-'));
  roots.push(root);
  const dir = join(root, 'doc', '01.demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'requirements.md'), '| AC-001 | behavior |\n');
  writeFileSync(join(dir, 'plan.md'), plan);
  const progressPath = join(dir, 'progress.json');
  const progress = createProgressV2({ featureId: '01', featureSlug: 'demo', preset: 'preset-standard', mode: 'lean' });
  progress.state = state;
  progress.gates.plan = { approved: true, binding: planApprovalBinding(dir), approver: 'owner' };
  writeProgressV2(progressPath, progress);
  return { root, dir, progressPath };
}

const amend = (feature, overrides = {}) => requestPlanAmendment({
  cwd: feature.root, featureId: '01', progressPath: feature.progressPath,
  acs: ['AC-001'], paths: ['src/b.ts'], reason: 'caller chain', ...overrides,
});

test('a same-AC amendment extends paths without moving the Gateway A binding', () => {
  const feature = createApprovedFeature();
  const before = planApprovalBinding(feature.dir).combined_sha256;
  const { amendment } = amend(feature);
  assert.equal(amendment.id, 'A-1');
  assert.equal(amendment.status, 'pending_review');
  const plan = readFileSync(join(feature.dir, 'plan.md'), 'utf8');
  assert.match(plan, /\| A-1 \[feature\] AC-001: caller chain \(src\/b\.ts\) \| no \| pending_review \|/);
  assert.equal(planApprovalBinding(feature.dir).combined_sha256, before);
  assert.equal(readProgressV2(feature.progressPath).state, 'TEST_VERIFY_FAILED');
  assert.doesNotThrow(() => assertPlanApprovalCurrent(readProgressV2(feature.progressPath), feature.dir));
});

test('an amendment never edits a change-log heading inside the approval scope', () => {
  const inside = PLAN.replace('- risk_tier: medium', '## Plan Changes\n- risk_tier: medium').replace('## Plan Changes\n\n| Date', '## Elsewhere\n\n| Date');
  const feature = createApprovedFeature('IMPLEMENTING', inside);
  const before = planApprovalBinding(feature.dir).combined_sha256;
  amend(feature);
  assert.equal(planApprovalBinding(feature.dir).combined_sha256, before);
});

test('an amendment activates only after its independent review', () => {
  const feature = createApprovedFeature();
  amend(feature);
  assert.throws(() => amend(feature), /A-1 is still waiting/);
  const options = { cwd: feature.root, featureId: '01', progressPath: feature.progressPath, amendmentId: 'A-1' };
  assert.throws(() => reviewPlanAmendment({ ...options, status: 'blocked' }), /requires at least one P0\/P1/);
  const { amendment } = reviewPlanAmendment({ ...options, status: 'passed' });
  assert.equal(amendment.status, 'active');
  assert.match(readFileSync(join(feature.dir, 'plan.md'), 'utf8'), /\| no \| active \|/);
  assert.throws(() => reviewPlanAmendment({ ...options, status: 'passed' }), /already active/);
  assert.equal(amend(feature, { target: 'test-integration' }).amendment.id, 'A-2');
});

test('a blocked amendment review stays out of the allowed paths', () => {
  const feature = createApprovedFeature();
  amend(feature);
  const { amendment } = reviewPlanAmendment({
    cwd: feature.root, featureId: '01', progressPath: feature.progressPath,
    amendmentId: 'A-1', status: 'blocked', blockingFindings: ['P1: changes a permission boundary'],
  });
  assert.equal(amendment.status, 'blocked');
  assert.deepEqual(amendment.blocking_findings, ['P1: changes a permission boundary']);
});

test('an amendment refuses new criteria, unsafe paths, and states outside execution', () => {
  const feature = createApprovedFeature();
  assert.throws(() => amend(feature, { acs: ['AC-009'] }), /new criterion is a scope change/);
  assert.throws(() => amend(feature, { acs: [] }), /at least one approved AC/);
  assert.throws(() => amend(feature, { paths: [] }), /at least one path/);
  assert.throws(() => amend(feature, { paths: ['../secret'] }), /inside the repository/);
  assert.throws(() => amend(feature, { paths: ['/etc/hosts'] }), /inside the repository/);
  assert.throws(() => amend(feature, { target: 'production' }), /feature or test-integration/);
  assert.throws(() => amend(feature, { reason: ' ' }), /requires a reason/);
  assert.throws(() => amend(createApprovedFeature('RELEASE_PENDING_HUMAN')), /plan amendment requires/);
});

test('the CLI records an amendment and its review', () => {
  const feature = createApprovedFeature();
  const flags = ['--progress', feature.progressPath];
  const requested = runCcNexsCommand(['amend-plan', '01', '--ac', 'AC-001', '--path=src/b.ts', '--path', 'src/c.ts', '--reason', 'callers', '--target=test-integration', ...flags], { cwd: feature.root });
  assert.deepEqual(requested.amendment.paths, ['src/b.ts', 'src/c.ts']);
  assert.equal(requested.amendment.target, 'test-integration');
  const reviewed = runCcNexsCommand(['record-amendment-review', '01', '--amendment', 'A-1', '--blocked', '--finding', 'P1: new permission', ...flags], { cwd: feature.root });
  assert.equal(reviewed.amendment.status, 'blocked');
  assert.throws(() => runCcNexsCommand(['amend-plan', '01', '--unknown', ...flags], { cwd: feature.root }), /unknown option/);
});

test('an amendment requires the approved plan to be unchanged', () => {
  const feature = createApprovedFeature();
  writeFileSync(join(feature.dir, 'requirements.md'), '| AC-001 | edited behavior |\n');
  assert.throws(() => amend(feature), /changed after Gateway A/);
});

test('a real decision can return to Gateway A from every blocked execution state', () => {
  for (const state of ['LOCAL_VERIFY_FAILED', 'LOCAL_REVERIFY_FAILED', 'TEST_MERGE_CONFLICT', 'TEST_VERIFY_FAILED']) {
    const { progressPath } = createApprovedFeature(state);
    assert.throws(() => recordReleaseChangeRequest(progressPath, { kind: 'implementation', feedback: 'x' }), /use amend-plan/);
    const { progress } = recordReleaseChangeRequest(progressPath, { kind: 'scope', feedback: 'relax the lint gate' });
    assert.equal(progress.state, 'SCOPE_CHANGE_REQUESTED');
    assert.equal(progress.gates.plan.approved, false);
  }
  const { progressPath } = createApprovedFeature('IMPLEMENTING');
  assert.throws(() => recordReleaseChangeRequest(progressPath, { kind: 'scope', feedback: 'x' }), /release-gate changes require/);
});

test('milestones describe the current candidate and name what blocks it', () => {
  const progress = createProgressV2({ featureId: '01', featureSlug: 'demo', preset: 'preset-standard', mode: 'lean' });
  progress.gates.plan = { approved: true, binding: {} };
  progress.repositories.web = { candidate: { ref: 'refs/candidate', commit: null } };
  progress.local_verification = { status: 'passed', candidate_fingerprint: 'new', attempts: [] };
  progress.delivery.test.attempts = [{ id: 'test-release-1', status: 'verified', fingerprint: 'old', deployment: {}, environment_revision: {} }];
  const status = (rows) => Object.fromEntries(rows.map((item) => [item.id, item.status]));
  assert.deepEqual(status(deliveryMilestones(progress)), {
    plan: 'done', implementation: 'done', local_verification: 'done',
    test_deployment: 'pending', test_acceptance: 'pending', review: 'pending', base_merge: 'pending',
  });
  progress.delivery.test.attempts.push({ id: 'test-release-2', status: 'merge_conflict', fingerprint: 'new' });
  const blocked = deliveryMilestones(progress).find((item) => item.id === 'test_deployment');
  assert.deepEqual(blocked, { id: 'test_deployment', status: 'blocked', detail: 'test-release-2 merge_conflict' });
  progress.delivery.test.attempts.push({ id: 'test-release-3', status: 'failed', fingerprint: 'new', deployment: {}, environment_revision: {} });
  assert.deepEqual(status(deliveryMilestones(progress)).test_deployment, 'done');
  assert.deepEqual(status(deliveryMilestones(progress)).test_acceptance, 'blocked');
});
