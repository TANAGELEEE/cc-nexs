import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { approveFeatureGate, resolveFeatureProgress } from './approval-command.mjs';
import { runCcNexsCommand } from './cc-nexs-cli.mjs';
import { runBaseRelease } from './base-release.mjs';
import { hotfixScopeBinding } from './hotfix-contract.mjs';
import { planApprovalBinding } from './plan-contract.mjs';
import {
  beginTestRelease,
  completeTestRelease,
  createProgressV2,
  readProgressV2,
  recordConsolidatedReview,
  recordLocalVerification,
  recordTestIntegration,
  recordTestVerification,
  writeProgressV2,
} from './progress-v2.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createFeature({ id = '01', mode = 'lean', state, worktree = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-approval-'));
  roots.push(root);
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  copyFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../preset-standard/preset.yml'),
    join(root, '.cc-nexs', 'preset.yml'),
  );
  writeFileSync(join(root, 'cc-nexs.config.yml'), 'preset_path: .cc-nexs\n');
  writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), [
    'version: 1',
    'docs_repository: docs',
    'repositories:',
    '  - id: docs',
    '    path: all-docs',
    '    docs: true',
    '    base_branch: main',
    '  - id: api',
    '    path: api',
    '    base_branch: main',
    '    test_branch: test',
    '',
  ].join('\n'));
  const docs = worktree
    ? join(root, '.worktrees', `${id}-demo`, 'all-docs', 'doc', `${id}.demo`)
    : join(root, 'all-docs', 'doc', `${id}.demo`);
  mkdirSync(docs, { recursive: true });
  const progress = createProgressV2({
    featureId: id,
    featureSlug: 'demo',
    preset: 'preset-standard',
    mode,
    repositories: mode === 'lean' ? ['docs', 'api'] : [],
  });
  progress.state = state;
  const progressFile = join(docs, 'progress.json');
  writeProgressV2(progressFile, progress);
  writeFileSync(join(docs, 'progress.md'), progressMarkdown(state));
  if (mode === 'lean') {
    writeFileSync(join(docs, 'requirements.md'), '# Requirements\n\n| AC-ID | Then |\n|---|---|\n| AC-001 | works |\n');
    writeFileSync(join(docs, 'plan.md'), [
      '# Plan',
      '<!-- APPROVAL-SCOPE START -->',
      '## Tasks',
      '| T-001 | AC-001 |',
      '| LV-001 | AC-001 |',
      '| TV-001 | AC-001 |',
      '- risk_tier: medium',
      '- delivery_lane: fast-track',
      '- test_delivery.api: deploy',
      '<!-- APPROVAL-SCOPE END -->',
      '## Evidence',
      '',
    ].join('\n'));
    markPlanReviewed({ docs, progressFile });
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
    '## 历史轨迹',
    '',
    '- (尚无)',
    '',
  ].join('\n');
}

function markPlanReviewed({ docs, progressFile }, status = 'passed') {
  const progress = readProgressV2(progressFile);
  progress.plan_review = {
    status,
    plan_sha256: planApprovalBinding(docs, { requireRiskTier: true, requireDeliveryLane: true }).combined_sha256,
    rounds: 1,
    blocking_findings: status === 'blocked' ? ['P1: missing rollback'] : [],
  };
  writeProgressV2(progressFile, progress);
}

function writeLeanPlan(docs, scopeLines) {
  writeFileSync(join(docs, 'plan.md'), [
    '# Plan',
    '<!-- APPROVAL-SCOPE START -->',
    ...scopeLines,
    '<!-- APPROVAL-SCOPE END -->',
    '',
  ].join('\n'));
}

function bindCandidate(fixture, repository = 'api', content = 'candidate\n') {
  const repo = join(fixture.root, repository);
  mkdirSync(repo, { recursive: true });
  for (const args of [
    ['init'],
    ['config', 'user.name', 'Approval Test'],
    ['config', 'user.email', 'approval@example.com'],
  ]) {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  writeFileSync(join(repo, 'candidate.txt'), content);
  for (const args of [['add', 'candidate.txt'], ['commit', '-m', 'candidate']]) {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  const commit = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const candidateRef = `refs/cc-nexs/candidates/${repository}`;
  spawnSync('git', ['-C', repo, 'update-ref', candidateRef, commit], { encoding: 'utf8' });
  const progress = readProgressV2(fixture.progressFile);
  progress.repositories[repository] = {
    branch: 'feature/test', worktree: repository, base_branch: 'main', base_commit: commit,
    candidate: { commit: null, ref: candidateRef, paths: ['candidate.txt'] },
  };
  writeProgressV2(fixture.progressFile, progress);
  return commit;
}

test('feature resolution prefers the matching worktree and never another feature gate', () => {
  const fixture = createFeature({ id: '04', state: 'PLAN_PENDING_HUMAN', worktree: true });
  const other = join(fixture.root, 'all-docs', 'doc', '99.other');
  mkdirSync(other, { recursive: true });
  const otherProgress = createProgressV2({ featureId: '99', featureSlug: 'other', preset: 'preset-standard' });
  otherProgress.state = 'PLAN_PENDING_HUMAN';
  writeProgressV2(join(other, 'progress.json'), otherProgress);

  assert.equal(resolveFeatureProgress({ cwd: fixture.root, featureId: '04' }), fixture.progressFile);
});

test('terminal CLI executes the same deterministic approval path', () => {
  const fixture = createFeature({ id: '05', state: 'PLAN_PENDING_HUMAN' });
  const cli = join(dirname(fileURLToPath(import.meta.url)), 'cc-nexs-cli.mjs');
  const result = spawnSync(process.execPath, [
    cli,
    'approve-plan',
    '05',
    '--progress',
    fixture.progressFile,
    '--approver',
    'CLI User',
  ], { cwd: fixture.root, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cc-nexs PLAN approved/);
  assert.equal(readProgressV2(fixture.progressFile).gates.plan.approver, 'CLI User');
});

test('Lean Gateway A hashes requirements and plan scope before advancing', () => {
  const fixture = createFeature({ id: '20', mode: 'lean', state: 'PLAN_PENDING_HUMAN' });
  const result = approveFeatureGate({ cwd: fixture.root, featureId: '20', gate: 'plan', approver: 'Plan Owner' });
  const progress = readProgressV2(fixture.progressFile);

  assert.equal(result.state, 'PLAN_APPROVED');
  assert.equal(progress.gates.plan.approved, true);
  assert.match(progress.gates.plan.binding.combined_sha256, /^[a-f0-9]{64}$/);
  assert.equal(progress.gates.plan.binding.risk_tier, 'medium');
  assert.equal(progress.gates.plan.binding.delivery_lane, 'fast-track');
  assert.deepEqual(progress.gates.plan.binding.test_delivery, { api: 'deploy' });
  assert.equal(progress.gates.plan.binding.delivery_contract_version, 2);
  assert.deepEqual(progress.gates.plan.binding.test_targets, { api: 'test' });
  assert.deepEqual(progress.events.map((event) => event.type), ['gate.approved', 'state.transition']);
});

test('Lean Gateway A requires a plan review bound to the exact plan and full requirement traceability', () => {
  const fixture = createFeature({ id: '20r', mode: 'lean', state: 'PLAN_PENDING_HUMAN' });
  const approve = () => approveFeatureGate({ cwd: fixture.root, featureId: '20r', gate: 'plan', approver: 'Plan Owner' });
  const scope = ['| T-001 | AC-001 |', '| LV-001 | AC-001 |', '| TV-001 | AC-001 |', '- risk_tier: medium', '- delivery_lane: fast-track', '- test_delivery.api: deploy'];

  writeLeanPlan(fixture.docs, [...scope, '- note: changed after review']);
  assert.throws(approve, /independent plan review of the current plan/);

  writeFileSync(join(fixture.docs, 'requirements.md'), '| AC-ID | Then |\n|---|---|\n| AC-001 | works |\n| AC-002 | audited |\n');
  writeLeanPlan(fixture.docs, scope);
  markPlanReviewed(fixture);
  assert.throws(approve, /does not trace every requirement \(task: AC-002; local check: AC-002; test check: AC-002\)/);

  writeLeanPlan(fixture.docs, ['| T-001 | AC-001, AC-002 |', '| LV-001 | AC-001, AC-002 |', '| TV-001 | AC-001 |', '| TV-002 | AC-002 |', ...scope.slice(3)]);
  markPlanReviewed(fixture, 'blocked');
  const approved = approveFeatureGate({ cwd: fixture.root, featureId: '20r', gate: 'plan', approver: 'Plan Owner' });
  assert.equal(approved.state, 'PLAN_APPROVED');
  assert.deepEqual(readProgressV2(fixture.progressFile).gates.plan.binding.plan_review, { status: 'blocked', rounds: 1, blocking_findings: ['P1: missing rollback'] });
});

test('plan review sends only a blocked first round back to the Planner', () => {
  const fixture = createFeature({ id: '20s', mode: 'lean', state: 'PLAN_REVIEWING' });
  const reset = readProgressV2(fixture.progressFile);
  reset.plan_review = null;
  writeProgressV2(fixture.progressFile, reset);
  const cli = join(dirname(fileURLToPath(import.meta.url)), 'cc-nexs-cli.mjs');
  const record = (...flags) => spawnSync(process.execPath, [cli, 'record-plan-review', '20s', '--progress', fixture.progressFile, ...flags], { cwd: fixture.root, encoding: 'utf8' });
  const setState = (state) => { const p = readProgressV2(fixture.progressFile); p.state = state; writeProgressV2(fixture.progressFile, p); };

  const first = record('--blocked', '--finding', 'P1: AC-001 has no rollback check');
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /plan review blocked \(round 1\)/);
  assert.equal(readProgressV2(fixture.progressFile).state, 'PLAN_REVIEW_BLOCKED');

  setState('PLAN_REVIEWING');
  assert.equal(record('--blocked', '--finding', 'P1: still no rollback check').status, 0);
  assert.equal(readProgressV2(fixture.progressFile).state, 'PLAN_PENDING_HUMAN');

  // A plan edited at Gateway A can be reviewed again without reopening the revision loop.
  const third = record('--passed');
  assert.equal(third.status, 0, third.stderr);
  const saved = readProgressV2(fixture.progressFile);
  assert.equal(saved.state, 'PLAN_PENDING_HUMAN');
  assert.equal(saved.plan_review.rounds, 3);

  setState('IMPLEMENTING');
  assert.match(record('--passed').stderr, /plan review requires PLANNING, PLAN_REVIEWING, or PLAN_PENDING_HUMAN/);
});

test('Lean Gateway A rejects incomplete or mistyped test delivery topology before approval', () => {
  const fixture = createFeature({ id: '20a', mode: 'lean', state: 'PLAN_PENDING_HUMAN' });
  const approve = () => approveFeatureGate({
    cwd: fixture.root,
    featureId: '20a',
    gate: 'plan',
    approver: 'Plan Owner',
  });

  writeLeanPlan(fixture.docs, [
    '- risk_tier: medium',
    '- delivery_lane: fast-track',
  ]);
  assert.throws(approve, /missing test_delivery coverage.*api/);

  writeLeanPlan(fixture.docs, [
    '- risk_tier: medium',
    '- delivery_lane: fast-track',
    '- test_delivery.api: deploy',
    '- test_delivery.typo: local',
  ]);
  assert.throws(approve, /unknown or unassigned test_delivery repositories: typo/);

  assert.equal(readProgressV2(fixture.progressFile).gates.plan.approved, false);
  assert.equal(readProgressV2(fixture.progressFile).state, 'PLAN_PENDING_HUMAN');
});

test('Lean Gateway A requires an explicit lane and a deployable test target', () => {
  const fixture = createFeature({ id: '20b', mode: 'lean', state: 'PLAN_PENDING_HUMAN' });
  const approve = () => approveFeatureGate({
    cwd: fixture.root,
    featureId: '20b',
    gate: 'plan',
    approver: 'Plan Owner',
  });

  writeLeanPlan(fixture.docs, [
    '- risk_tier: medium',
    '- test_delivery.api: deploy',
  ]);
  assert.throws(approve, /requires plan\.md delivery_lane/);

  writeLeanPlan(fixture.docs, [
    '- risk_tier: medium',
    '- delivery_lane: fast-track',
    '- test_delivery.api: local',
  ]);
  assert.throws(approve, /requires at least one assigned code repository.*deploy/);

  writeFileSync(join(fixture.root, '.cc-nexs', 'workspace.yml'), [
    'version: 1',
    'docs_repository: docs',
    'repositories:',
    '  - id: docs',
    '    path: all-docs',
    '    docs: true',
    '  - id: api',
    '    path: api',
    '',
  ].join('\n'));
  writeLeanPlan(fixture.docs, [
    '- risk_tier: medium',
    '- delivery_lane: fast-track',
    '- test_delivery.api: deploy',
  ]);
  assert.throws(approve, /api is marked deploy but has no test_branch/);
});

test('Lean Gateway A preserves already-approved legacy early-return compatibility', () => {
  const fixture = createFeature({ id: '20c', mode: 'lean', state: 'PLAN_APPROVED' });
  const progress = readProgressV2(fixture.progressFile);
  progress.gates.plan = {
    approved: true,
    approver: 'Legacy Owner',
    approved_at: new Date().toISOString(),
    binding: { combined_sha256: 'legacy' },
  };
  writeProgressV2(fixture.progressFile, progress);
  writeFileSync(join(fixture.root, '.cc-nexs', 'workspace.yml'), 'version: 1\n');
  writeLeanPlan(fixture.docs, ['- risk_tier: medium']);

  const result = approveFeatureGate({
    cwd: fixture.root,
    featureId: '20c',
    gate: 'plan',
    approver: 'New Owner',
  });

  assert.equal(result.alreadyApproved, true);
  assert.equal(result.approver, 'Legacy Owner');
  assert.equal(readProgressV2(fixture.progressFile).revision, progress.revision);
});

test('Lean Gateway A explicitly upgrades an approved v1 delivery contract with exact test targets', () => {
  const fixture = createFeature({ id: '20d', mode: 'lean', state: 'PLAN_APPROVED' });
  const progress = readProgressV2(fixture.progressFile);
  progress.gates.plan = {
    approved: true,
    approver: 'Legacy Owner',
    approved_at: new Date().toISOString(),
    binding: planApprovalBinding(fixture.docs, { requireRiskTier: true, requireDeliveryLane: true }),
  };
  writeProgressV2(fixture.progressFile, progress);

  const result = approveFeatureGate({
    cwd: fixture.root,
    featureId: '20d',
    gate: 'plan',
    approver: 'Target Owner',
  });
  const upgraded = readProgressV2(fixture.progressFile);
  assert.equal(result.alreadyApproved, false);
  assert.equal(upgraded.gates.plan.binding.delivery_contract_version, 2);
  assert.deepEqual(upgraded.gates.plan.binding.test_targets, { api: 'test' });
  assert.equal(upgraded.gates.plan.approver, 'Target Owner');

  const crashed = createFeature({ id: '20e', mode: 'lean', state: 'PLAN_PENDING_HUMAN' });
  const crashedProgress = readProgressV2(crashed.progressFile);
  crashedProgress.gates.plan = {
    approved: true,
    approver: 'Original Owner',
    approved_at: new Date().toISOString(),
    binding: planApprovalBinding(crashed.docs, { requireRiskTier: true, requireDeliveryLane: true }),
  };
  writeProgressV2(crashed.progressFile, crashedProgress);
  approveFeatureGate({ cwd: crashed.root, featureId: '20e', gate: 'plan', approver: 'Retry Owner' });
  const recovered = readProgressV2(crashed.progressFile);
  assert.equal(recovered.state, 'PLAN_APPROVED');
  assert.equal(recovered.gates.plan.binding.delivery_contract_version, 2);
  assert.deepEqual(recovered.gates.plan.binding.test_targets, { api: 'test' });
});

for (const initialReleaseState of ['RELEASE_PENDING_HUMAN', 'TEST_RELEASE']) test(`Lean Gateway B binds verified evidence from ${initialReleaseState}`, () => {
  const fixture = createFeature({ id: '21', mode: 'lean', state: 'PLAN_PENDING_HUMAN' });
  approveFeatureGate({ cwd: fixture.root, featureId: '21', gate: 'plan', approver: 'Plan Owner' });
  const source = { api: bindCandidate(fixture) };
  recordLocalVerification(fixture.progressFile, { source, status: 'passed', evidence: [{ check: 'regression', result: 'passed', command: 'node check.mjs', exit_code: 0, proof: 'regression passed' }] });
  recordConsolidatedReview(fixture.progressFile, { source, status: 'passed' });
  const release = beginTestRelease(fixture.progressFile, { source });
  completeTestRelease(fixture.progressFile, {
    attemptId: release.attempt.id,
    status: 'succeeded',
    pipeline: { id: 'p1' },
    deployment: { id: 'd1', environment: 'test' },
    environmentRevision: { api: 'merge123' },
  });
  recordTestVerification(fixture.progressFile, { attemptId: release.attempt.id, result: 'passed', evidence: ['test.json'] });
  const ready = readProgressV2(fixture.progressFile);
  ready.state = initialReleaseState;
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

  writeFileSync(join(fixture.root, 'api', 'candidate.txt'), 'moved candidate\n');
  for (const args of [['add', 'candidate.txt'], ['commit', '-m', 'moved candidate'], ['update-ref', 'refs/cc-nexs/candidates/api', 'HEAD']]) {
    const gitResult = spawnSync('git', ['-C', join(fixture.root, 'api'), ...args], { encoding: 'utf8' });
    if (gitResult.status !== 0) throw new Error(gitResult.stderr);
  }
  assert.throws(
    () => approveFeatureGate({ cwd: fixture.root, featureId: '21', gate: 'release', approver: 'Release Owner' }),
    /candidate ref moved after test verification/,
  );
  spawnSync('git', ['-C', join(fixture.root, 'api'), 'update-ref', 'refs/cc-nexs/candidates/api', source.api], { encoding: 'utf8' });

  const validLocal = readProgressV2(fixture.progressFile);
  const invalidLocal = structuredClone(validLocal);
  invalidLocal.local_verification.attempts.at(-1).evidence = [];
  writeProgressV2(fixture.progressFile, invalidLocal);
  assert.throws(() => approveFeatureGate({ cwd: fixture.root, featureId: '21', gate: 'release', approver: 'Release Owner' }), /structured evidence/);
  writeProgressV2(fixture.progressFile, structuredClone(validLocal));

  const result = approveFeatureGate({ cwd: fixture.root, featureId: '21', gate: 'release', approver: 'Release Owner' });
  const progress = readProgressV2(fixture.progressFile);
  assert.equal(result.state, 'RELEASE_PENDING_HUMAN');
  assert.equal(progress.gates.release.approved, true);
  assert.deepEqual(progress.gates.release.binding.source, source);
  assert.deepEqual(progress.gates.release.binding.base_targets, { api: 'main' });
  assert.equal(progress.gates.release.binding.test_attempt, release.attempt.id);
  assert.equal(progress.gates.release.binding.candidate_fingerprint, progress.review.candidate_fingerprint);
  assert.equal(progress.change_requests.current, null);
  assert.match(readFileSync(join(fixture.docs, 'plan.md'), 'utf8'), /gateway-b-1 .*\| approved \|/);

  progress.state = 'BASE_MERGING';
  writeProgressV2(fixture.progressFile, progress);
  const invalidBaseEvidence = structuredClone(progress);
  invalidBaseEvidence.local_verification.attempts.at(-1).evidence = [];
  writeProgressV2(fixture.progressFile, invalidBaseEvidence);
  assert.throws(() => approveFeatureGate({ cwd: fixture.root, featureId: '21', gate: 'release', approver: 'Release Owner' }), /structured evidence/);
  withPresetEnv(fixture, () => {
  assert.throws(() => runBaseRelease({ cwd: fixture.root, featureId: '21' }), /structured evidence/);
  });
  assert.equal(readProgressV2(fixture.progressFile).state, 'BASE_MERGE_BLOCKED');
  writeProgressV2(fixture.progressFile, structuredClone(progress));

  writeFileSync(join(fixture.root, '.cc-nexs', 'workspace.yml'), [
    'version: 1',
    'docs_repository: docs',
    'repositories:',
    '  - id: docs',
    '    path: all-docs',
    '    docs: true',
    '    base_branch: main',
    '  - id: api',
    '    path: api',
    '    base_branch: release',
    '    test_branch: test',
    '',
  ].join('\n'));
  withPresetEnv(fixture, () => {
  assert.throws(
    () => runBaseRelease({ cwd: fixture.root, featureId: '21' }),
    /workspace base branch changed after release approval for api/,
  );
  });
  assert.equal(readProgressV2(fixture.progressFile).state, 'BASE_MERGE_BLOCKED');
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
  const source = { api: bindCandidate(fixture, 'api', 'hotfix candidate\n') };
  recordLocalVerification(fixture.progressFile, { source, status: 'passed', evidence: [{ check: 'regression', result: 'passed', command: 'node check.mjs', exit_code: 0, proof: 'regression passed' }] });
  recordConsolidatedReview(fixture.progressFile, { source, status: 'passed' });
  const release = beginTestRelease(fixture.progressFile, { source });
  completeTestRelease(fixture.progressFile, {
    attemptId: release.attempt.id, status: 'succeeded', pipeline: { id: 'p-hotfix' },
    deployment: { id: 'd-hotfix', environment: 'test' }, environmentRevision: { api: 'test-merge' },
  });
  recordTestVerification(fixture.progressFile, { attemptId: release.attempt.id, result: 'passed', evidence: ['repro passed'] });
  const ready = readProgressV2(fixture.progressFile);
  ready.state = 'HOTFIX_RELEASE_PENDING_HUMAN';
  writeProgressV2(fixture.progressFile, ready);

  approveFeatureGate({ cwd: fixture.root, featureId: '23', gate: 'release', approver: 'Hotfix Owner' });
  const approved = readProgressV2(fixture.progressFile);
  assert.equal(approved.gates.release.approved, true);
  assert.equal(approved.gates.release.binding.candidate_fingerprint, approved.review.candidate_fingerprint);
  assert.deepEqual(approved.gates.release.binding.base_targets, { api: 'main' });
  assert.equal(approved.gates.release.binding.hotfix_scope_binding, approved.hotfix.scope_binding.hotfix_scope_sha256);
});

const testException = {
  authorizationEvidence: 'User explicitly authorized this candidate to proceed to base and formal acceptance',
  reason: 'Test account permissions prevent the required acceptance path',
  environmentEvidence: 'Test administrator confirmed the missing role; request returned HTTP 403',
  rollbackEvidence: 'Revert to the recorded base commit; no data migration',
};

function withPresetEnv(fixture, fn) {
  const saved = process.env.CC_NEXS_PLUGIN_ROOT;
  try {
    process.env.CC_NEXS_PLUGIN_ROOT = join(fixture.root, '.cc-nexs');
    return fn();
  } finally {
    if (saved === undefined) delete process.env.CC_NEXS_PLUGIN_ROOT;
    else process.env.CC_NEXS_PLUGIN_ROOT = saved;
  }
}

function createEnvironmentBlockedCandidate(mode, id) {
  const fixture = createFeature({ id, mode, state: mode === 'lean' ? 'PLAN_PENDING_HUMAN' : 'HOTFIX_TEST_VERIFYING' });
  if (mode === 'lean') approveFeatureGate({ cwd: fixture.root, featureId: id, gate: 'plan', approver: 'Owner' });
  const base = bindCandidate(fixture);
  const repo = join(fixture.root, 'api');
  const git = (path, args) => {
    const result = spawnSync('git', ['-C', path, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(repo, ['branch', '-M', 'main']);
  git(repo, ['init', '--bare', join(fixture.root, 'remote.git')]);
  git(repo, ['remote', 'add', 'origin', join(fixture.root, 'remote.git')]);
  git(repo, ['push', 'origin', 'main']);
  const worktree = join(fixture.root, 'api-feature');
  git(repo, ['worktree', 'add', '-b', 'feature/test', worktree, 'main']);
  writeFileSync(join(worktree, 'candidate.txt'), 'fixed\n');
  git(worktree, ['add', 'candidate.txt']);
  git(worktree, ['commit', '-m', 'fix']);
  const source = { api: git(worktree, ['rev-parse', 'HEAD']) };
  git(repo, ['update-ref', 'refs/cc-nexs/candidates/api', source.api]);
  const assigned = readProgressV2(fixture.progressFile);
  assigned.repositories.api.worktree = 'api-feature';
  writeProgressV2(fixture.progressFile, assigned);
  recordLocalVerification(fixture.progressFile, {
    source, status: 'passed', evidence: [{ check: 'repro', result: 'passed', command: 'node repro.mjs', exit_code: 0, proof: 'regression passed' }],
  });
  recordConsolidatedReview(fixture.progressFile, { source, status: 'passed' });
  const { attempt } = beginTestRelease(fixture.progressFile, { source });
  recordTestIntegration(fixture.progressFile, {
    attemptId: attempt.id, repository: 'api', sourceCommit: source.api,
    targetBranch: 'test', targetBefore: base, integrationCommit: source.api,
  });
  completeTestRelease(fixture.progressFile, {
    attemptId: attempt.id, status: 'succeeded', pipeline: { id: 'pipeline-1' },
    deployment: { environment: 'test' }, environmentRevision: source,
  });
  recordTestVerification(fixture.progressFile, { attemptId: attempt.id, result: 'manual_required', evidence: [testException.environmentEvidence] });
  const blocked = readProgressV2(fixture.progressFile);
  blocked.state = mode === 'hotfix' ? 'HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY' : 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY';
  writeProgressV2(fixture.progressFile, blocked);
  return { ...fixture, git, repo, source };
}

test('explicit test-environment exception reaches base release without claiming test passed', () => {
  for (const [mode, id] of [['lean', '24'], ['hotfix', '25']]) {
    const fixture = createEnvironmentBlockedCandidate(mode, id);
    withPresetEnv(fixture, () => {
    const initialAttempt = readProgressV2(fixture.progressFile).delivery.test.attempts.at(-1);
    assert.throws(() => approveFeatureGate({ cwd: fixture.root, featureId: id, gate: 'release', approver: 'Owner' }), /release gate requires/);
    const approval = approveFeatureGate({ cwd: fixture.root, featureId: id, gate: 'release', approver: 'Owner', testException });
    const approved = readProgressV2(fixture.progressFile);
    assert.equal(approval.state, mode === 'hotfix' ? 'HOTFIX_RELEASE_PENDING_HUMAN' : 'RELEASE_PENDING_HUMAN');
    assert.deepEqual(approved.delivery.test.attempts.at(-1), initialAttempt);
    assert.equal(approved.gates.release.binding.test_exception.authorization_evidence, testException.authorizationEvidence);
    approved.state = mode === 'hotfix' ? 'HOTFIX_BASE_MERGING' : 'BASE_MERGING';
    writeProgressV2(fixture.progressFile, approved);
    const leftoverConflict = join(fixture.root, '.cc-nexs', 'runtime', 'test-conflicts', approved.feature.id, 'test-release-1', 'api');
    mkdirSync(dirname(leftoverConflict), { recursive: true });
    fixture.git(fixture.repo, ['worktree', 'add', '--detach', leftoverConflict, 'origin/main']);
    assert.equal(runBaseRelease({ cwd: fixture.root, featureId: id }).status, 'succeeded');
    assert.equal(existsSync(join(fixture.root, '.cc-nexs', 'runtime', 'test-conflicts', approved.feature.id)), false);
    assert.doesNotMatch(fixture.git(fixture.repo, ['worktree', 'list', '--porcelain']), /test-conflicts/);
    const released = readProgressV2(fixture.progressFile);
    assert.equal(released.delivery.test.status, 'deployed_needs_manual_verification');
    assert.deepEqual(released.delivery.test.attempts.at(-1), initialAttempt);
    fixture.git(fixture.repo, ['merge-base', '--is-ancestor', fixture.source.api, 'origin/main']);
    });
  }
});

test('base release still requires unchanged exception evidence', () => {
  const fixture = createEnvironmentBlockedCandidate('hotfix', '26-evidence');
  withPresetEnv(fixture, () => {
    approveFeatureGate({ cwd: fixture.root, featureId: '26-evidence', gate: 'release', approver: 'Owner', testException });
    const approved = readProgressV2(fixture.progressFile);
    approved.state = 'HOTFIX_BASE_MERGING';
    approved.delivery.test.attempts.at(-1).verification.evidence = ['changed'];
    writeProgressV2(fixture.progressFile, approved);
    assert.throws(() => runBaseRelease({ cwd: fixture.root, featureId: '26-evidence' }), /exception evidence changed/);
    assert.equal(readProgressV2(fixture.progressFile).state, 'HOTFIX_BASE_MERGE_BLOCKED');
  });
});

test('base release integrates a newer non-conflicting base without invalidating the tested candidate', () => {
  const fixture = createEnvironmentBlockedCandidate('hotfix', '26-base');
  withPresetEnv(fixture, () => {
    approveFeatureGate({ cwd: fixture.root, featureId: '26-base', gate: 'release', approver: 'Owner', testException });
    const approved = readProgressV2(fixture.progressFile);
    const testAttempt = approved.delivery.test.attempts.at(-1);
    approved.state = 'HOTFIX_BASE_MERGING';
    writeFileSync(join(fixture.repo, 'unrelated.txt'), 'another team\n');
    fixture.git(fixture.repo, ['add', 'unrelated.txt']);
    fixture.git(fixture.repo, ['commit', '-m', 'unrelated base change']);
    fixture.git(fixture.repo, ['push', 'origin', 'main']);
    const newerBase = fixture.git(fixture.repo, ['rev-parse', 'HEAD']);
    writeProgressV2(fixture.progressFile, approved);
    assert.equal(runBaseRelease({ cwd: fixture.root, featureId: '26-base' }).status, 'succeeded');
    const released = readProgressV2(fixture.progressFile);
    assert.equal(released.delivery.test.attempts.length, 1);
    assert.deepEqual(released.delivery.test.attempts.at(-1), testAttempt);
    fixture.git(fixture.repo, ['merge-base', '--is-ancestor', newerBase, 'origin/main']);
    fixture.git(fixture.repo, ['merge-base', '--is-ancestor', fixture.source.api, 'origin/main']);
    assert.equal(fixture.git(fixture.repo, ['show', 'origin/main:unrelated.txt']), 'another team');
  });
});

for (const changedPath of ['candidate.txt', 'package.json', 'go.mod']) {
test(`base release refuses overlapping or sensitive paths (${changedPath}) without mutating candidate or test evidence`, () => {
  const fixture = createEnvironmentBlockedCandidate('lean', '26-overlap');
  withPresetEnv(fixture, () => {
    approveFeatureGate({ cwd: fixture.root, featureId: '26-overlap', gate: 'release', approver: 'Owner', testException });
    const approved = readProgressV2(fixture.progressFile);
    approved.state = 'BASE_MERGING';
    writeProgressV2(fixture.progressFile, approved);
    writeFileSync(join(fixture.repo, changedPath), 'other implementation\n');
    fixture.git(fixture.repo, ['add', changedPath]);
    fixture.git(fixture.repo, ['commit', '-m', 'overlapping change']);
    fixture.git(fixture.repo, ['push', 'origin', 'main']);
    const remoteBefore = fixture.git(fixture.repo, ['rev-parse', 'origin/main']);
    assert.throws(() => runBaseRelease({ cwd: fixture.root, featureId: '26-overlap' }), /BASE_CHANGED.*(overlaps|shared runtime or contract)/);
    const blocked = readProgressV2(fixture.progressFile);
    assert.equal(blocked.state, 'BASE_CHANGED');
    assert.deepEqual(blocked.delivery.test, approved.delivery.test);
    assert.equal(fixture.git(fixture.repo, ['rev-parse', 'refs/cc-nexs/candidates/api']), fixture.source.api);
    assert.equal(fixture.git(fixture.repo, ['rev-parse', 'origin/main']), remoteBefore);
  });
});
}

test('scope-invalidated test attempts cannot retain release approval or authorize base integration', () => {
  const fixture = createEnvironmentBlockedCandidate('hotfix', '27');
  withPresetEnv(fixture, () => {
  approveFeatureGate({ cwd: fixture.root, featureId: '27', gate: 'release', approver: 'Owner', testException });
  const progress = readProgressV2(fixture.progressFile);
  progress.delivery.test.attempts.at(-1).invalidated_at = new Date().toISOString();
  writeProgressV2(fixture.progressFile, progress);
  assert.throws(() => approveFeatureGate({ cwd: fixture.root, featureId: '27', gate: 'release', approver: 'Owner', testException }), /attempt was invalidated/);
  progress.state = 'HOTFIX_BASE_MERGING';
  writeProgressV2(fixture.progressFile, progress);
  assert.throws(() => approveFeatureGate({ cwd: fixture.root, featureId: '27', gate: 'release', approver: 'Owner' }), /attempt was invalidated/);
  assert.throws(() => runBaseRelease({ cwd: fixture.root, featureId: '27' }), /attempt was invalidated/);
  assert.equal(readProgressV2(fixture.progressFile).state, 'HOTFIX_BASE_MERGE_BLOCKED');
  });
});


test('feature discovery follows configured docs and external worktrees after Hotfix promotion', () => {
  const fixture = createFeature({ id: '20260926-repair', mode: 'lean', state: 'PLANNING' });
  const worktrees = mkdtempSync(join(tmpdir(), 'cc-nexs-custom-worktrees-'));
  roots.push(worktrees);
  rmSync(fixture.progressFile);
  rmSync(join(fixture.root, '.cc-nexs', 'workspace.yml'));
  writeFileSync(join(fixture.root, '.cc-nexs', 'workspace.json'), JSON.stringify({
    version: 1, docs_repository: 'docs', worktree_root: worktrees,
    repositories: [{ id: 'docs', path: 'knowledge', docs: true }],
  }));
  const archived = join(fixture.root, 'knowledge', 'doc', '09.parent', 'bugs', 'BUG-repair.lean', 'progress.json');
  const active = join(worktrees, '20260926-repair', 'docs', 'doc', '09.parent', 'bugs', 'BUG-repair.lean', 'progress.json');
  const progress = createProgressV2({ featureId: '20260926-repair', featureSlug: 'repair', preset: 'preset-standard', mode: 'lean' });
  for (const file of [archived, active]) {
    mkdirSync(dirname(file), { recursive: true });
    writeProgressV2(file, progress);
  }
  const nested = join(fixture.root, 'services', 'nested');
  mkdirSync(nested, { recursive: true });
  assert.equal(resolveFeatureProgress({ cwd: nested, featureId: progress.feature.id }), active);
  rmSync(active);
  assert.equal(resolveFeatureProgress({ cwd: fixture.root, featureId: progress.feature.id }), archived);
});

test('explicit progress paths reject a different task while keeping numeric ID aliases', () => {
  const fixture = createFeature({ id: '04', state: 'PLAN_PENDING_HUMAN' });
  assert.equal(resolveFeatureProgress({ cwd: fixture.root, featureId: '4', progressPath: fixture.progressFile }), fixture.progressFile);
  assert.throws(() => runCcNexsCommand(['revise-hotfix', 'BUG-other', '--progress', fixture.progressFile, '--reason', 'same failure', '--authorization-evidence', 'user requested repair'], { cwd: fixture.root }), /feature mismatch: requested BUG-other, found 04/);
  assert.equal(readProgressV2(fixture.progressFile).revision, 0);
});

test('BASE_CHANGED clean sync resumes verification; real conflict remains developer-owned', () => {
  for (const file of ['package.json', 'candidate.txt']) {
    const fixture = createEnvironmentBlockedCandidate('lean', `sync-${file.replace('.', '-')}`);
    withPresetEnv(fixture, () => {
      const state = readProgressV2(fixture.progressFile);
      state.state = 'BASE_CHANGED';
      writeProgressV2(fixture.progressFile, state);
      writeFileSync(join(fixture.repo, file), 'upstream\n');
      fixture.git(fixture.repo, ['add', file]);
      fixture.git(fixture.repo, ['commit', '-m', 'upstream']);
      fixture.git(fixture.repo, ['push', 'origin', 'main']);
      const result = runCcNexsCommand(['sync-base', state.feature.id], { cwd: fixture.root });
      assert.equal(result.conflicts, file === 'candidate.txt');
      assert.equal(result.state, file === 'candidate.txt' ? 'IMPLEMENTING' : 'LOCAL_VERIFYING');
      const after = readProgressV2(fixture.progressFile);
      assert.equal(after.gates.release.approved, false);
      assert.equal(after.local_verification.status, 'idle');
      assert.deepEqual(after.delivery.test.attempts, state.delivery.test.attempts);
    });
  }
});

test('protected MR pending is resumed and remote merge reconciles ledger and cleanup', () => {
  const fixture = createEnvironmentBlockedCandidate('hotfix', 'mr-resume');
  withPresetEnv(fixture, () => {
    writeFileSync(join(fixture.root, 'cc-nexs.config.yml'), `preset_path: .cc-nexs\nrelease:\n  base:\n    driver:\n      command: ${process.execPath}\n      args: [mr.mjs]\n`);
    writeFileSync(join(fixture.root, 'mr.mjs'), `import {appendFileSync} from 'node:fs'; let s=''; for await(const c of process.stdin)s+=c; const p=JSON.parse(s); appendFileSync('mr.log',JSON.stringify(p)+'\\n'); console.log(JSON.stringify({status:'pending',url:'https://git.example/mr/1'}));`);
    approveFeatureGate({ cwd: fixture.root, featureId: 'mr-resume', gate: 'release', approver: 'Owner', testException });
    const p = readProgressV2(fixture.progressFile); p.state = 'HOTFIX_BASE_MERGING'; writeProgressV2(fixture.progressFile, p);
    assert.equal(runBaseRelease({ cwd: fixture.root, featureId: 'mr-resume' }).status, 'running');
    assert.equal(runBaseRelease({ cwd: fixture.root, featureId: 'mr-resume' }).status, 'running');
    const calls = readFileSync(join(fixture.root, 'mr.log'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls[0].sourceBranch, calls[1].sourceBranch);
    fixture.git(fixture.repo, ['push', 'origin', `${calls[0].integrationCommit}:refs/heads/main`]);
    assert.equal(runBaseRelease({ cwd: fixture.root, featureId: 'mr-resume' }).status, 'succeeded');
    assert.equal(readProgressV2(fixture.progressFile).delivery.base.attempts.length, 1);
    assert.equal(runBaseRelease({ cwd: fixture.root, featureId: 'mr-resume' }).status, 'succeeded');
  });
});

test('environment exception accepts CI-closed local deferrals but never unclosed checks', () => {
  const fixture = createEnvironmentBlockedCandidate('lean', '98');
  const progress = readProgressV2(fixture.progressFile);
  const attempt = progress.delivery.test.attempts.at(-1);
  const local = progress.local_verification.attempts.at(-1);
  progress.local_verification.status = local.status = 'deferred_to_test';
  local.evidence.push({ check: 'docs-bootstrap', result: 'deferred_to_test', reason: 'test docs API unavailable locally', test_action: 'CI must bootstrap docs and compile the exact integrated candidate' });
  writeProgressV2(fixture.progressFile, progress);
  assert.throws(() => approveFeatureGate({ cwd: fixture.root, featureId: '98', gate: 'release', approver: 'Owner', testException }), /close deferred checks/);
  const closed = readProgressV2(fixture.progressFile);
  closed.delivery.test.attempts.at(-1).verification.evidence.push({ check: 'docs-bootstrap', result: 'passed', proof: 'CI job completed bootstrap and compilation for the bound revision' });
  writeProgressV2(fixture.progressFile, closed);
  approveFeatureGate({ cwd: fixture.root, featureId: '98', gate: 'release', approver: 'Owner', testException });
  const approved = readProgressV2(fixture.progressFile);
  assert.equal(approved.gates.release.approved, true);
  assert.equal(approved.delivery.test.attempts.at(-1).id, attempt.id);
  assert.equal(approved.delivery.test.status, 'deployed_needs_manual_verification');
});
