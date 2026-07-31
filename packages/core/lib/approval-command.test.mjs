import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { approveFeatureGate, resolveFeatureProgress } from './approval-command.mjs';
import { hotfixScopeBinding } from './hotfix-contract.mjs';
import {
  beginTestRelease,
  completeTestRelease,
  createProgressV2,
  readProgressV2,
  recordConsolidatedReview,
  recordLocalVerification,
  recordTestVerification,
  writeProgressV2,
} from './progress-v2.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createFeature({ id = '01', mode = 'fast', state, worktree = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-approval-'));
  roots.push(root);
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), 'version: 1\n');
  const docs = worktree
    ? join(root, '.worktrees', `${id}-demo`, 'all-docs', 'doc', `${id}.demo`)
    : join(root, 'all-docs', 'doc', `${id}.demo`);
  mkdirSync(docs, { recursive: true });
  const progress = createProgressV2({ featureId: id, featureSlug: 'demo', preset: 'preset-standard', mode });
  progress.state = state;
  const progressFile = join(docs, 'progress.json');
  writeProgressV2(progressFile, progress);
  writeFileSync(join(docs, 'progress.md'), progressMarkdown(state));
  if (mode === 'lean') {
    writeFileSync(join(docs, 'requirements.md'), '# Requirements\n\n- AC-001\n');
    writeFileSync(join(docs, 'plan.md'), [
      '# Plan',
      '<!-- APPROVAL-SCOPE START -->',
      '## Tasks',
      '- T-001 implements AC-001',
      '<!-- APPROVAL-SCOPE END -->',
      '## Evidence',
      '',
    ].join('\n'));
  }
  if (mode === 'hotfix') {
    writeFileSync(join(docs, 'hotfix.md'), [
      '# Hotfix',
      '<!-- HOTFIX-SCOPE START -->',
      '- severity: P2',
      '- related_feature: -',
      '- intended_paths: src/a.ts',
      '- acceptance_contract_change: no',
      '- api_contract_change: no',
      '- database_schema_change: no',
      '- permission_model_change: no',
      '- broad_refactor: no',
      '- non_behavioral_change: no',
      '<!-- HOTFIX-SCOPE END -->',
      '## Gateway B 变更请求',
      '',
    ].join('\n'));
    const hotfixProgress = readProgressV2(progressFile);
    const binding = hotfixScopeBinding(docs);
    hotfixProgress.hotfix = {
      severity: 'P2', related_feature: null, scope_binding: binding,
      scope_bound_at: new Date().toISOString(), review_required: true,
    };
    writeProgressV2(progressFile, hotfixProgress);
  }
  return { root, docs, progressFile };
}

function progressMarkdown(state) {
  return [
    '## 当前状态',
    '',
    '```yaml',
    `current_state: ${state}`,
    'updated_at: null',
    '```',
    '',
    '## 人工 gate',
    '',
    '### G1: Spec 审批',
    '',
    '```yaml',
    'human_approved_at: null',
    'human_approver: null',
    '```',
    '',
    '### G2: 部署测试环境确认',
    '',
    '```yaml',
    'g2_approved: false',
    'g2_approved_at: null',
    'g2_approver: null',
    '```',
    '',
    '## 历史轨迹',
    '',
    '- (尚无)',
    '',
  ].join('\n');
}

test('G1 approval records an event and advances only the workflow state', () => {
  const fixture = createFeature({ state: 'SPEC_PENDING_HUMAN' });
  const result = approveFeatureGate({ cwd: fixture.root, featureId: '01', gate: 'g1', approver: 'Local User' });
  const progress = readProgressV2(fixture.progressFile);
  const markdown = readFileSync(join(fixture.docs, 'progress.md'), 'utf8');

  assert.equal(result.state, 'SPEC_APPROVED');
  assert.equal(progress.gates.g1.approved, true);
  assert.equal(progress.gates.g1.approver, 'Local User');
  assert.equal(progress.state, 'SPEC_APPROVED');
  assert.deepEqual(progress.events.map((event) => event.type), ['gate.approved', 'state.transition']);
  assert.match(markdown, /human_approver: Local User/);
  assert.match(markdown, /current_state: SPEC_APPROVED/);
});

test('fast G2 approval records the gate but leaves transition ownership to run', () => {
  const fixture = createFeature({ id: '02', state: 'DEPLOY_GATE' });
  const result = approveFeatureGate({ cwd: fixture.root, featureId: '02', gate: 'g2', sprint: 'M1', approver: 'Local User' });
  const progress = readProgressV2(fixture.progressFile);
  const markdown = readFileSync(join(fixture.docs, 'progress.md'), 'utf8');

  assert.equal(result.sprint, null);
  assert.equal(progress.state, 'DEPLOY_GATE');
  assert.equal(progress.gates.g2.approved, true);
  assert.deepEqual(progress.events.map((event) => event.type), ['gate.approved']);
  assert.match(markdown, /g2_approved: true/);
  assert.match(markdown, /g2_approver: Local User/);
});

test('final-only G2 approval supports manual fallback from TEST_RELEASE', () => {
  const fixture = createFeature({ id: '16', mode: 'full', state: 'TEST_RELEASE' });
  const result = approveFeatureGate({
    cwd: fixture.root,
    featureId: '16',
    gate: 'g2',
    approver: 'manual-release-owner',
  });
  assert.equal(result.state, 'TEST_RELEASE');
  assert.equal(result.sprint, null);
  assert.equal(readProgressV2(fixture.progressFile).gates.g2.approved, true);
});

test('full G2 approval is scoped to the sprint encoded in the state', () => {
  const fixture = createFeature({ id: '03', mode: 'full', state: 'SPRINT_2_DEPLOY_GATE' });
  const result = approveFeatureGate({ cwd: fixture.root, featureId: '03', gate: 'g2', approver: 'Local User' });
  const progress = readProgressV2(fixture.progressFile);

  assert.equal(result.sprint, 2);
  assert.equal(progress.gates.g2.sprints['2'].approved, true);
  assert.equal(progress.gates.g2.sprints['1'], undefined);
  assert.throws(
    () => approveFeatureGate({ cwd: fixture.root, featureId: '03', gate: 'g2', sprint: 'M1', approver: 'Local User' }),
    /sprint mismatch/,
  );
});

test('feature resolution prefers the matching worktree and never another feature gate', () => {
  const fixture = createFeature({ id: '04', state: 'DEPLOY_GATE', worktree: true });
  const other = join(fixture.root, 'all-docs', 'doc', '99.other');
  mkdirSync(other, { recursive: true });
  const otherProgress = createProgressV2({ featureId: '99', featureSlug: 'other', preset: 'preset-standard' });
  otherProgress.state = 'SPEC_PENDING_HUMAN';
  writeProgressV2(join(other, 'progress.json'), otherProgress);

  assert.equal(resolveFeatureProgress({ cwd: fixture.root, featureId: '04' }), fixture.progressFile);
});

test('terminal CLI executes the same deterministic approval path', () => {
  const fixture = createFeature({ id: '05', state: 'DEPLOY_GATE' });
  const cli = join(dirname(fileURLToPath(import.meta.url)), 'cc-nexs-cli.mjs');
  const result = spawnSync(process.execPath, [
    cli,
    'approve-deploy',
    '05',
    '--progress',
    fixture.progressFile,
    '--approver',
    'CLI User',
  ], { cwd: fixture.root, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cc-nexs G2 approved/);
  assert.equal(readProgressV2(fixture.progressFile).gates.g2.approver, 'CLI User');
});

test('Lean Gateway A hashes requirements and plan scope before advancing', () => {
  const fixture = createFeature({ id: '20', mode: 'lean', state: 'PLAN_PENDING_HUMAN' });
  const result = approveFeatureGate({ cwd: fixture.root, featureId: '20', gate: 'plan', approver: 'Plan Owner' });
  const progress = readProgressV2(fixture.progressFile);

  assert.equal(result.state, 'PLAN_APPROVED');
  assert.equal(progress.gates.plan.approved, true);
  assert.match(progress.gates.plan.binding.combined_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(progress.events.map((event) => event.type), ['gate.approved', 'state.transition']);
});

test('Lean Gateway B binds the exact reviewed and test-verified candidate', () => {
  const fixture = createFeature({ id: '21', mode: 'lean', state: 'PLAN_PENDING_HUMAN' });
  approveFeatureGate({ cwd: fixture.root, featureId: '21', gate: 'plan', approver: 'Plan Owner' });
  const source = { api: 'abc123' };
  recordLocalVerification(fixture.progressFile, { source, status: 'passed', evidence: ['local.json'] });
  recordConsolidatedReview(fixture.progressFile, { source, status: 'passed' });
  const release = beginTestRelease(fixture.progressFile, { source });
  completeTestRelease(fixture.progressFile, {
    attemptId: release.attempt.id,
    status: 'succeeded',
    pipeline: { id: 'p1' },
    deployment: { id: 'd1' },
    environmentRevision: { api: 'merge123' },
  });
  recordTestVerification(fixture.progressFile, { attemptId: release.attempt.id, result: 'passed', evidence: ['test.json'] });
  const ready = readProgressV2(fixture.progressFile);
  ready.state = 'RELEASE_PENDING_HUMAN';
  ready.change_requests = {
    current: 'gateway-b-1',
    items: [{
      id: 'gateway-b-1',
      kind: 'implementation',
      feedback: 'fix',
      affected_acs: ['AC-001'],
      paths: ['src/a.ts'],
      status: 'open',
      requested_by: 'owner',
      requested_at: new Date().toISOString(),
    }],
  };
  writeProgressV2(fixture.progressFile, ready);
  writeFileSync(join(fixture.docs, 'plan.md'), `${readFileSync(join(fixture.docs, 'plan.md'), 'utf8')}\n## Gateway B 变更请求\n\n| ID | 类型 | 提出人 | 影响 AC | 允许修改路径 | 意见 | 状态 |\n|---|---|---|---|---|---|---|\n| gateway-b-1 | implementation | owner | AC-001 | src/a.ts | fix | open |\n`);

  const result = approveFeatureGate({ cwd: fixture.root, featureId: '21', gate: 'release', approver: 'Release Owner' });
  const progress = readProgressV2(fixture.progressFile);
  assert.equal(result.state, 'RELEASE_PENDING_HUMAN');
  assert.equal(progress.gates.release.approved, true);
  assert.deepEqual(progress.gates.release.binding.source, source);
  assert.equal(progress.gates.release.binding.test_attempt, release.attempt.id);
  assert.equal(progress.gates.release.binding.candidate_fingerprint, progress.review.candidate_fingerprint);
  assert.equal(progress.change_requests.current, null);
  assert.match(readFileSync(join(fixture.docs, 'plan.md'), 'utf8'), /gateway-b-1 .*\| approved \|/);
});

test('Lean release approval fails closed when approved plan scope changed', () => {
  const fixture = createFeature({ id: '22', mode: 'lean', state: 'PLAN_PENDING_HUMAN' });
  approveFeatureGate({ cwd: fixture.root, featureId: '22', gate: 'plan', approver: 'Plan Owner' });
  writeFileSync(join(fixture.docs, 'plan.md'), [
    '# Plan',
    '<!-- APPROVAL-SCOPE START -->',
    '- changed scope',
    '<!-- APPROVAL-SCOPE END -->',
  ].join('\n'));
  const changed = readProgressV2(fixture.progressFile);
  changed.state = 'RELEASE_PENDING_HUMAN';
  writeProgressV2(fixture.progressFile, changed);
  assert.throws(
    () => approveFeatureGate({ cwd: fixture.root, featureId: '22', gate: 'release', approver: 'Release Owner' }),
    /changed after Gateway A/,
  );
});

test('Hotfix Gateway B binds the same reviewed and test-verified feature candidate', () => {
  const fixture = createFeature({ id: '23', mode: 'hotfix', state: 'HOTFIX_RELEASE_PENDING_HUMAN' });
  const source = { api: 'hotfix123' };
  recordLocalVerification(fixture.progressFile, { source, status: 'passed', evidence: ['local'] });
  recordConsolidatedReview(fixture.progressFile, { source, status: 'passed' });
  const release = beginTestRelease(fixture.progressFile, { source });
  completeTestRelease(fixture.progressFile, {
    attemptId: release.attempt.id, status: 'succeeded', pipeline: { id: 'p-hotfix' },
    deployment: { id: 'd-hotfix' }, environmentRevision: { api: 'test-merge' },
  });
  recordTestVerification(fixture.progressFile, { attemptId: release.attempt.id, result: 'passed', evidence: ['repro passed'] });
  const ready = readProgressV2(fixture.progressFile);
  ready.state = 'HOTFIX_RELEASE_PENDING_HUMAN';
  writeProgressV2(fixture.progressFile, ready);

  approveFeatureGate({ cwd: fixture.root, featureId: '23', gate: 'release', approver: 'Hotfix Owner' });
  const approved = readProgressV2(fixture.progressFile);
  assert.equal(approved.gates.release.approved, true);
  assert.equal(approved.gates.release.binding.candidate_fingerprint, approved.review.candidate_fingerprint);
  assert.equal(approved.gates.release.binding.hotfix_scope_binding, approved.hotfix.scope_binding.hotfix_scope_sha256);
});
