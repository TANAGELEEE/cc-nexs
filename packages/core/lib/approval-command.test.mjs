import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { approveFeatureGate, resolveFeatureProgress } from './approval-command.mjs';
import { runCcNexsCommand } from './cc-nexs-cli.mjs';
import { runBaseRelease } from './base-release.mjs';
import { hotfixScopeBinding } from './hotfix-contract.mjs';
import { implementationApprovalBinding } from './implementation-plan.mjs';
import { planApprovalBinding } from './plan-contract.mjs';
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
  if (['fast', 'full', 'lite'].includes(mode)) {
    writeFileSync(join(docs, 'spec.md'), '# Spec\n\n## 业务背景\n\nLegacy single-worker spec.\n\n## 变更记录\n');
  }
  if (mode === 'lean') {
    writeFileSync(join(docs, 'requirements.md'), '# Requirements\n\n- AC-001\n');
    writeFileSync(join(docs, 'plan.md'), [
      '# Plan',
      '<!-- APPROVAL-SCOPE START -->',
      '## Tasks',
      '- T-001 implements AC-001',
      '- risk_tier: medium',
      '- delivery_lane: fast-track',
      '- test_delivery.api: deploy',
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

test('G1 approval records an event and advances only the workflow state', () => {
  const fixture = createFeature({ state: 'SPEC_PENDING_HUMAN' });
  const result = approveFeatureGate({ cwd: fixture.root, featureId: '01', gate: 'g1', approver: 'Local User' });
  const progress = readProgressV2(fixture.progressFile);
  const markdown = readFileSync(join(fixture.docs, 'progress.md'), 'utf8');

  assert.equal(result.state, 'SPEC_APPROVED');
  assert.equal(progress.gates.g1.approved, true);
  assert.equal(progress.gates.g1.approver, 'Local User');
  assert.equal(progress.gates.g1.binding.contract_version, 0);
  assert.equal(progress.gates.g1.binding.sprint_total, 1);
  assert.deepEqual(progress.sprint, { enabled: false, current: 1, total: 1, status: {} });
  assert.equal(progress.state, 'SPEC_APPROVED');
  assert.deepEqual(progress.events.map((event) => event.type), ['gate.approved', 'state.transition']);
  assert.match(markdown, /human_approver: Local User/);
  assert.match(markdown, /current_state: SPEC_APPROVED/);
});

test('G1 binds Fast/Full implementation ownership and runtime rejects later drift', () => {
  const fixture = createFeature({ id: '01b', state: 'SPEC_PENDING_HUMAN' });
  const progress = readProgressV2(fixture.progressFile);
  progress.repositories.api = { branch: 'feature/01b', worktree: 'api', candidate: null };
  writeProgressV2(fixture.progressFile, progress);
  const specFile = join(fixture.docs, 'spec.md');
  writeFileSync(specFile, [
    '# Spec',
    '| AC-ID | Given | When | Then | 关联 Sprint |',
    '|---|---|---|---|---|',
    '| AC-001 | a | b | c | M1 |',
    '<!-- IMPLEMENTATION-OWNERSHIP:START -->',
    '| Assignment | Sprint | Surface | AC | Repository | Allowed paths | Depends on | Validation | Wave |',
    '|---|---|---|---|---|---|---|---|---|',
    '| IMP-api | M1 | backend | AC-001 | api | src/upload/** | - | unit | 1 |',
    '<!-- IMPLEMENTATION-OWNERSHIP:END -->',
    '## 变更记录',
  ].join('\n'));

  approveFeatureGate({ cwd: fixture.root, featureId: '01b', gate: 'g1', approver: 'Local User' });
  const approved = readProgressV2(fixture.progressFile);
  assert.equal(approved.gates.g1.binding.contract_version, 1);
  assert.equal(approved.gates.g1.binding.sprint_total, 1);
  assert.equal(approved.sprint.current, 1);
  assert.equal(approved.sprint.total, 1);
  assert.equal(runCcNexsCommand(['validate-implementation-plan', '01b'], { cwd: fixture.root }).assignments.length, 1);

  writeFileSync(specFile, readFileSync(specFile, 'utf8').replace('src/upload/**', 'src/other/**'));
  assert.throws(() => runCcNexsCommand(['validate-implementation-plan', '01b'], { cwd: fixture.root }), /changed after G1/);
});

test('G1 crash recovery rechecks the exact approved implementation binding before transition', () => {
  const fixture = createFeature({ id: '01c', state: 'SPEC_PENDING_HUMAN' });
  const progress = readProgressV2(fixture.progressFile);
  progress.repositories.api = { branch: 'feature/01c', worktree: 'api', candidate: null };
  const specFile = join(fixture.docs, 'spec.md');
  const specText = [
    '# Spec',
    '| AC-ID | Given | When | Then | 所属 Sprint |',
    '|---|---|---|---|---|',
    '| AC-001 | a | b | c | M1 |',
    '<!-- IMPLEMENTATION-OWNERSHIP:START -->',
    '| Assignment | Sprint | Surface | AC | Repository | Allowed paths | Depends on | Validation | Wave |',
    '|---|---|---|---|---|---|---|---|---|',
    '| IMP-api | M1 | backend | AC-001 | api | src/upload/** | - | unit | 1 |',
    '<!-- IMPLEMENTATION-OWNERSHIP:END -->',
    '## 变更记录',
  ].join('\n');
  writeFileSync(specFile, specText);
  progress.gates.g1 = {
    approved: true,
    approver: 'Local User',
    approved_at: new Date().toISOString(),
    binding: implementationApprovalBinding(specText, { repositories: ['api'], mode: 'fast' }),
  };
  writeProgressV2(fixture.progressFile, progress);

  writeFileSync(specFile, specText.replace('src/upload/**', 'src/other/**'));
  assert.throws(() => approveFeatureGate({
    cwd: fixture.root, featureId: '01c', gate: 'g1', approver: 'Local User',
  }), /changed after G1/);
  assert.equal(readProgressV2(fixture.progressFile).state, 'SPEC_PENDING_HUMAN');

  writeFileSync(specFile, specText);
  assert.equal(approveFeatureGate({
    cwd: fixture.root, featureId: '01c', gate: 'g1', approver: 'Local User',
  }).state, 'SPEC_APPROVED');
  const recovered = readProgressV2(fixture.progressFile);
  assert.equal(recovered.sprint.current, 1);
  assert.equal(recovered.sprint.total, 1);
  assert.equal(recovered.events.some((event) => event.type === 'g1.sprint_contract_recovered'), true);
});

test('Full G1 freezes and persists the exact contiguous Sprint total for CLI/runtime', () => {
  const fixture = createFeature({ id: '01d', mode: 'full', state: 'SPEC_PENDING_HUMAN' });
  const progress = readProgressV2(fixture.progressFile);
  progress.repositories.api = { branch: 'feature/01d', worktree: 'api', candidate: null };
  writeProgressV2(fixture.progressFile, progress);
  writeFileSync(join(fixture.docs, 'spec.md'), [
    '# Spec',
    '| AC-ID | Given | When | Then | 所属 Sprint |',
    '|---|---|---|---|---|',
    '| AC-001 | a | b | c | M1 |',
    '| AC-002 | a | b | c | M2 |',
    '<!-- IMPLEMENTATION-OWNERSHIP:START -->',
    '| Assignment | Sprint | Surface | AC | Repository | Allowed paths | Depends on | Validation | Wave |',
    '|---|---|---|---|---|---|---|---|---|',
    '| IMP-api-1 | M1 | backend | AC-001 | api | src/one/** | - | unit | 1 |',
    '| IMP-api-2 | M2 | backend | AC-002 | api | src/two/** | - | unit | 1 |',
    '<!-- IMPLEMENTATION-OWNERSHIP:END -->',
    '## 变更记录',
  ].join('\n'));

  approveFeatureGate({ cwd: fixture.root, featureId: '01d', gate: 'g1', approver: 'Local User' });
  let approved = readProgressV2(fixture.progressFile);
  assert.deepEqual(approved.gates.g1.binding.sprints, ['M1', 'M2']);
  assert.equal(approved.gates.g1.binding.sprint_total, 2);
  assert.deepEqual(approved.sprint, { enabled: true, current: 1, total: 2, status: {} });
  const validated = runCcNexsCommand(['validate-implementation-plan', '01d'], { cwd: fixture.root });
  assert.deepEqual(validated.sprints, ['M1', 'M2']);
  assert.equal(validated.sprintTotal, 2);

  approved.sprint.total = 3;
  writeProgressV2(fixture.progressFile, approved);
  assert.throws(() => runCcNexsCommand(['validate-implementation-plan', '01d'], {
    cwd: fixture.root,
  }), /Sprint state drifted/);
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
  assert.equal(progress.gates.plan.binding.risk_tier, 'medium');
  assert.equal(progress.gates.plan.binding.delivery_lane, 'fast-track');
  assert.deepEqual(progress.gates.plan.binding.test_delivery, { api: 'deploy' });
  assert.equal(progress.gates.plan.binding.delivery_contract_version, 2);
  assert.deepEqual(progress.gates.plan.binding.test_targets, { api: 'test' });
  assert.deepEqual(progress.events.map((event) => event.type), ['gate.approved', 'state.transition']);
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

test('Lean Gateway B binds the exact reviewed and test-verified candidate', () => {
  const fixture = createFeature({ id: '21', mode: 'lean', state: 'PLAN_PENDING_HUMAN' });
  approveFeatureGate({ cwd: fixture.root, featureId: '21', gate: 'plan', approver: 'Plan Owner' });
  const source = { api: bindCandidate(fixture) };
  recordLocalVerification(fixture.progressFile, { source, status: 'passed', evidence: ['local.json'] });
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
  assert.throws(
    () => runBaseRelease({ cwd: fixture.root, featureId: '21' }),
    /workspace base branch changed after release approval for api/,
  );
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
  recordLocalVerification(fixture.progressFile, { source, status: 'passed', evidence: ['local'] });
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
