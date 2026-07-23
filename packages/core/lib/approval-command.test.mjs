import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { approveFeatureGate, resolveFeatureProgress } from './approval-command.mjs';
import { createProgressV2, readProgressV2, writeProgressV2 } from './progress-v2.mjs';

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
