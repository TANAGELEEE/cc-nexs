import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  beginTestRelease,
  candidateFingerprint,
  createProgressV2,
  readProgressV2,
  recordTestIntegration,
  writeProgressV2,
} from './progress-v2.mjs';
import { resolveTestConflict } from './test-conflict.mjs';
import { completeTestRelease, appendProgressEvent } from './progress-v2.mjs';
import { switchTestTarget, validateTestTarget } from './test-target.mjs';
import { planApprovalBinding } from './plan-contract.mjs';
import { integrateCandidateToTest } from './git-custodian.mjs';
import {
  acquireTestReleaseLock,
  invokeTestReleaseDriver,
  resolveTestReleasePolicy,
  runTestRelease,
} from './test-release.mjs';
import { runCcNexsCommand } from './cc-nexs-cli.mjs';

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function configure(repo) {
  git(repo, ['config', 'user.name', 'Release Test']);
  git(repo, ['config', 'user.email', 'release-test@example.com']);
}

function gatewayATestBinding(reqDir, testTargets) {
  return {
    ...planApprovalBinding(reqDir, { requireRiskTier: true }),
    delivery_contract_version: 2,
    test_targets: testTargets,
  };
}

test('persisted delivery policy protects legacy features while feature config remains explicit', () => {
  assert.equal(resolveTestReleasePolicy({
    progress: {}, featureConfig: {}, configured: 'auto_if_ready',
  }), 'manual');
  assert.equal(resolveTestReleasePolicy({
    progress: { delivery: { test: { policy: 'manual' } } }, featureConfig: {}, configured: 'auto_if_ready',
  }), 'manual');
  assert.equal(resolveTestReleasePolicy({
    progress: { delivery: { test: { policy: 'manual' } } },
    featureConfig: { release: { test: 'auto' } },
    configured: 'auto_if_ready',
  }), 'auto_if_ready');
  assert.equal(resolveTestReleasePolicy({
    progress: { delivery: { test: { policy: 'auto_if_ready' } } },
    featureConfig: {},
    configured: 'auto_if_ready',
    configuredOverride: 'manual',
  }), 'manual');
  assert.equal(resolveTestReleasePolicy({
    progress: { delivery: { test: { policy: 'auto_if_ready' } } },
    featureConfig: {},
    configured: 'auto_if_ready',
    configuredOverride: 'disabled',
  }), 'disabled');
});

test('test release lock rejects a concurrent controller and releases cleanly', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-release-lock-'));
  const progressFile = join(root, 'progress.json');
  const release = acquireTestReleaseLock(progressFile);
  try {
    assert.throws(() => acquireTestReleaseLock(progressFile), /another test release controller/);
  } finally {
    release();
    rmSync(root, { recursive: true, force: true });
  }
});

test('test release integrates candidates, invokes structured driver, records evidence, and is idempotent', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-release-controller-'));
  const origin = join(root, 'origin.git');
  const code = join(root, 'code');
  const other = join(root, 'other');
  const featureWorktree = join(root, '.worktrees', '05-demo', 'code');
  const reqDir = join(root, '.worktrees', '05-demo', 'docs', 'doc', '05.demo');
  mkdirSync(origin, { recursive: true });
  git(origin, ['init', '--bare']);
  git(root, ['clone', origin, code]);
  configure(code);
  git(code, ['checkout', '-b', 'master']);
  writeFileSync(join(code, 'base.txt'), 'base\n');
  git(code, ['add', 'base.txt']);
  git(code, ['commit', '-m', 'base']);
  git(code, ['push', '-u', 'origin', 'master']);
  git(code, ['checkout', '-b', 'test']);
  writeFileSync(join(code, 'test.txt'), 'test\n');
  git(code, ['add', 'test.txt']);
  git(code, ['commit', '-m', 'test']);
  git(code, ['push', '-u', 'origin', 'test']);
  git(code, ['worktree', 'add', '-b', 'feature/05-demo', featureWorktree, 'origin/master']);
  writeFileSync(join(featureWorktree, 'feature.txt'), 'feature\n');
  git(featureWorktree, ['add', 'feature.txt']);
  git(featureWorktree, ['commit', '-m', 'feature']);
  const sourceCommit = git(featureWorktree, ['rev-parse', 'HEAD']);
  const candidateRef = 'refs/cc-nexs/candidates/05-demo/code';
  git(code, ['update-ref', candidateRef, sourceCommit]);
  mkdirSync(other, { recursive: true });
  git(other, ['init']);
  configure(other);
  git(other, ['checkout', '-b', 'feature/05-demo']);
  writeFileSync(join(other, 'web.txt'), 'local web\n');
  git(other, ['add', 'web.txt']);
  git(other, ['commit', '-m', 'local web candidate']);
  const localSourceCommit = git(other, ['rev-parse', 'HEAD']);
  const localCandidateRef = 'refs/cc-nexs/candidates/05-demo/other';
  git(other, ['update-ref', localCandidateRef, localSourceCommit]);

  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'workspace.json'), `${JSON.stringify({
    version: 1,
    repositories: [
      { id: 'code', path: 'code', base_branch: 'master', test_branch: 'test', release_order: 10 },
      { id: 'other', path: 'other', base_branch: 'master', release_order: 20 },
    ],
  }, null, 2)}\n`);
  const projectConfigFile = join(root, 'cc-nexs.config.json');
  const projectConfig = {
    workflow: { sprint_delivery: 'final_only', test_release: { policy: 'auto_if_ready' } },
    release: {
      test: {
        environment: 'test',
        app_url: 'https://test.example.com',
        operations_url: 'https://ops.example.com',
        allowed_hosts: ['test.example.com', 'ops.example.com'],
        driver: { command: 'node', args: ['release-driver.mjs'], timeout_seconds: 10 },
      },
    },
  };
  writeFileSync(projectConfigFile, `${JSON.stringify(projectConfig, null, 2)}\n`);
  writeFileSync(join(root, 'release-driver.mjs'), [
    "import { appendFileSync } from 'node:fs';",
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "for await (const chunk of process.stdin) input += chunk;",
    "const request = JSON.parse(input);",
    "appendFileSync('release-driver.log', request.operation + '\\n');",
    "const revision = Object.fromEntries(Object.entries(request.integrations).map(([id, value]) => [id, value.integrationCommit]));",
    "if (request.operation === 'release_test') console.log(JSON.stringify({ status: 'pending', pipeline: { id: 'pipeline-1', url: 'https://ci.example/pipeline-1' } }));",
    "else console.log(JSON.stringify({ status: 'succeeded', deployment: { id: 'deploy-1', environment: 'test', endpoints: { api: 'https://api-test.example.com' } }, environment_revision: revision }));",
  ].join('\n'));
  mkdirSync(reqDir, { recursive: true });
  const progressFile = join(reqDir, 'progress.json');
  writeFileSync(join(reqDir, 'requirements.md'), '# Requirements\n');
  writeFileSync(join(reqDir, 'plan.md'), '# Plan\n\n<!-- APPROVAL-SCOPE START -->\n- risk_tier: low\n- delivery_lane: fast-track\n- test_delivery.code: deploy\n- test_delivery.other: local\n<!-- APPROVAL-SCOPE END -->\n');
  const progress = createProgressV2({ featureId: '05', featureSlug: 'demo', preset: 'preset-standard', mode: 'lean' });
  progress.state = 'TEST_RELEASE';
  progress.gates.plan = { approved: true, binding: gatewayATestBinding(reqDir, { code: 'test' }) };
  progress.repositories.code = {
    branch: 'feature/05-demo',
    worktree: '.worktrees/05-demo/code',
    base_branch: 'master',
    base_commit: git(code, ['rev-parse', 'origin/master']),
    candidate: { commit: null, ref: candidateRef, paths: ['feature.txt'] },
  };
  progress.repositories.other = {
    branch: 'feature/05-demo',
    worktree: 'other',
    base_branch: 'master',
    base_commit: null,
    candidate: null,
  };
  const exactSource = { code: sourceCommit, other: localSourceCommit };
  progress.local_verification = {
    status: 'passed',
    context: 'implementation',
    candidate_fingerprint: candidateFingerprint(exactSource),
    attempts: [{
      id: 'local-verify-1',
      status: 'passed',
      context: 'implementation',
      fingerprint: candidateFingerprint(exactSource),
      source: exactSource,
      evidence: [{ check: 'regression', result: 'passed', command: 'node --test regression.test.mjs', exit_code: 0, proof: 'regression passed' }],
      completed_at: new Date().toISOString(),
    }],
  };
  writeProgressV2(progressFile, progress);
  writeFileSync(join(reqDir, 'config.json'), '{"mode":"full","release":{"test":"inherit"}}\n');

  try {
    assert.throws(
      () => runCcNexsCommand(['release-test', '05', '--dry-run', '--progress', progressFile], { cwd: root }),
      /assigned repository other is missing a candidate ref/,
    );
    const completeProgress = readProgressV2(progressFile);
    completeProgress.repositories.other.candidate = {
      commit: null,
      ref: localCandidateRef,
      paths: ['web.txt'],
    };
    writeProgressV2(progressFile, structuredClone(completeProgress));
    const invalidLocal = structuredClone(completeProgress);
    invalidLocal.local_verification.attempts.at(-1).evidence = [];
    writeProgressV2(progressFile, invalidLocal);
    assert.throws(() => runCcNexsCommand(['release-test', '05', '--dry-run', '--progress', progressFile], { cwd: root }), /structured evidence/);
    writeProgressV2(progressFile, structuredClone(completeProgress));


    const approvedPlan = readFileSync(join(reqDir, 'plan.md'), 'utf8');
    writeFileSync(join(reqDir, 'plan.md'), approvedPlan.replace('test_delivery.other: local', 'test_delivery.other: deploy'));
    const deployOnlyProgress = readProgressV2(progressFile);
    deployOnlyProgress.gates.plan.binding = gatewayATestBinding(reqDir, { code: 'test', other: 'test' });
    writeProgressV2(progressFile, deployOnlyProgress);
    assert.throws(
      () => runCcNexsCommand(['release-test', '05', '--dry-run', '--progress', progressFile], { cwd: root }),
      /repository other is marked deploy but has no test_branch/,
    );
    writeFileSync(join(reqDir, 'plan.md'), approvedPlan);
    const localPlanProgress = readProgressV2(progressFile);
    localPlanProgress.gates.plan.binding = gatewayATestBinding(reqDir, { code: 'test' });
    writeProgressV2(progressFile, localPlanProgress);

    writeFileSync(join(root, '.cc-nexs', 'workspace.json'), `${JSON.stringify({
      version: 1,
      repositories: [
        { id: 'code', path: 'code', base_branch: 'master', test_branch: 'qa', release_order: 10 },
        { id: 'other', path: 'other', base_branch: 'master', release_order: 20 },
      ],
    }, null, 2)}\n`);
    assert.throws(
      () => runCcNexsCommand(['release-test', '05', '--dry-run', '--progress', progressFile], { cwd: root }),
      /workspace test branch changed after Gateway A for code: approved test, current qa/,
    );
    writeFileSync(join(root, '.cc-nexs', 'workspace.json'), `${JSON.stringify({
      version: 1,
      repositories: [
        { id: 'code', path: 'code', base_branch: 'master', test_branch: 'test', release_order: 10 },
        { id: 'other', path: 'other', base_branch: 'master', release_order: 20 },
      ],
    }, null, 2)}\n`);

    const poison = join(other, 'untracked-runtime-config.js');
    writeFileSync(poison, 'export default "wrong candidate";\n');
    assert.throws(
      () => runCcNexsCommand(['release-test', '05', '--dry-run', '--progress', progressFile], { cwd: root }),
      /worktree must be clean at exact candidate/,
    );
    rmSync(poison);

    const manualProjectConfig = structuredClone(projectConfig);
    manualProjectConfig.workflow.test_release.policy = 'manual';
    writeFileSync(projectConfigFile, `${JSON.stringify(manualProjectConfig, null, 2)}\n`);
    assert.throws(
      () => runCcNexsCommand(['release-test', '05', '--dry-run', '--progress', progressFile], { cwd: root }),
      /automatic test release is manual/,
    );

    const missingUrlConfig = structuredClone(projectConfig);
    delete missingUrlConfig.release.test.operations_url;
    writeFileSync(projectConfigFile, `${JSON.stringify(missingUrlConfig, null, 2)}\n`);
    const missingUrl = runCcNexsCommand(['release-test', '05', '--dry-run', '--progress', progressFile], { cwd: root });
    assert.equal(missingUrl.verificationPrerequisites.ready, false);
    assert.ok(missingUrl.verificationPrerequisites.missing.includes('release.test.operations_url'));

    assert.throws(
      () => runCcNexsCommand(['release-test', '05', '--dry-run', '--hotfix', '--progress', progressFile], { cwd: root }),
      /--hotfix requires mode hotfix/,
    );

    const dryRun = runCcNexsCommand(['release-test', '05', '--dry-run', '--progress', progressFile], { cwd: root });
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.verificationPrerequisites.ready, false);
    assert.deepEqual(
      dryRun.repositories.map(({ id, delivery }) => ({ id, delivery })),
      [{ id: 'code', delivery: 'test_branch' }, { id: 'other', delivery: 'local' }],
    );
    assert.equal(readProgressV2(progressFile).delivery.test.attempts.length, 0);
    assert.throws(() => git(code, ['show', 'origin/test:feature.txt']));

    const result = runTestRelease({ cwd: root, featureId: '05', progressPath: progressFile });
    assert.equal(result.attempt.status, 'deploying');
    assert.equal(result.verificationPrerequisites.ready, false);
    assert.equal(git(code, ['show', 'origin/test:feature.txt']), 'feature');
    assert.equal(git(code, ['show', 'origin/test:test.txt']), 'test');
    const featureHead = git(featureWorktree, ['rev-parse', 'HEAD']);
    assert.equal(featureHead, sourceCommit);

    const saved = readProgressV2(progressFile);
    assert.equal(saved.delivery.test.attempts.length, 1);
    assert.equal(saved.delivery.test.attempts[0].pipeline.id, 'pipeline-1');
    assert.equal(saved.delivery.test.attempts[0].integrations.code.sourceCommit, sourceCommit);
    assert.equal(saved.delivery.test.attempts[0].integrations.other, undefined);
    assert.equal(saved.delivery.test.attempts[0].source.other, localSourceCommit);

    const repeated = runTestRelease({ cwd: root, featureId: '05', progressPath: progressFile });
    assert.equal(repeated.reused, true);
    assert.equal(repeated.attempt.status, 'deploying');
    assert.equal(readProgressV2(progressFile).delivery.test.attempts.length, 1);

    const resumed = runCcNexsCommand(['release-test', '05', '--resume', '--progress', progressFile], { cwd: root });
    assert.equal(resumed.attempt.status, 'succeeded');
    assert.deepEqual(readProgressV2(progressFile).delivery.test.attempts[0].deployment.endpoints, { api: 'https://api-test.example.com' });
    assert.equal(readFileSync(join(root, 'release-driver.log'), 'utf8'), 'release_test\nrelease_test_status\n');

    const verificationOnlyConfig = structuredClone(missingUrlConfig);
    verificationOnlyConfig.workflow.test_release.policy = 'manual';
    delete verificationOnlyConfig.release.test.driver;
    writeFileSync(projectConfigFile, `${JSON.stringify(verificationOnlyConfig, null, 2)}\n`);

    const latePoison = join(other, 'late-untracked-config.js');
    writeFileSync(latePoison, 'export default "polluted";\n');
    assert.throws(
      () => runCcNexsCommand([
        'record-test-verification', '05', '--passed', '--evidence', 'hybrid smoke passed', '--progress', progressFile,
      ], { cwd: root }),
      /worktree must be clean at exact candidate/,
    );
    rmSync(latePoison);
    const verified = runCcNexsCommand([
      'record-test-verification', '05', '--passed', '--evidence', 'hybrid smoke passed', '--progress', progressFile,
    ], { cwd: root });
    assert.equal(verified.status, 'passed');
    assert.equal(readProgressV2(progressFile).delivery.test.status, 'verified');
    assert.equal(readProgressV2(progressFile).state, 'TEST_VERIFIED');
    const previous = readProgressV2(progressFile).delivery.test.attempts.at(-1);
    const target = { kind: 'test', environment: 'test02', branches: { code: 'test02' }, allowed_hosts: ['test02.example.com'], app_url: 'https://test02.example.com', operations_url: 'https://test02.example.com/ops' };
    git(code, ['push', 'origin', 'origin/master:refs/heads/test02']);
    const oldPlugin = process.env.CC_NEXS_PLUGIN_ROOT;
    process.env.CC_NEXS_PLUGIN_ROOT = new URL('../../preset-standard', import.meta.url).pathname;
    try { switchTestTarget({ cwd: root, featureId: '05', progressPath: progressFile, target, authorizationEvidence: 'user requested test02' }); }
    finally { if (oldPlugin === undefined) delete process.env.CC_NEXS_PLUGIN_ROOT; else process.env.CC_NEXS_PLUGIN_ROOT = oldPlugin; }
    writeFileSync(projectConfigFile, JSON.stringify(projectConfig));
    writeFileSync(join(root, 'release-driver.mjs'), `let s='';for await(const c of process.stdin)s+=c;const p=JSON.parse(s);console.log(JSON.stringify(p.operation==='release_test'?{status:'awaiting_receipt',reason:'CI receipt temporarily unavailable'}:{status:'succeeded',pipeline:{id:'p2'},deployment:{environment:p.environment},environment_revision:Object.fromEntries(Object.entries(p.integrations).map(([k,v])=>[k,v.integrationCommit]))}));`);
    const switched = runTestRelease({ cwd: root, featureId: '05', progressPath: progressFile });
    assert.equal(switched.attempt.status, 'awaiting_receipt');
    assert.equal(switched.environment, 'test02');
    assert.throws(() => runTestRelease({ cwd: root, featureId: '05', progressPath: progressFile, retry: true }), /must be resumed/);
    const completed = runTestRelease({ cwd: root, featureId: '05', progressPath: progressFile, resume: true });
    assert.equal(completed.attempt.status, 'succeeded');
    assert.equal(completed.attempt.id, switched.attempt.id);
    assert.deepEqual(completed.attempt.source, previous.source);
    assert.equal(readProgressV2(progressFile).delivery.test.attempts.length, 2);
    assert.ok(readProgressV2(progressFile).delivery.test.attempts[0].invalidated_at);

  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const scenario of ['running', 'failed', 'conflict', 'conflict-invalidated', 'conflict-superseded', 'conflict-target-advanced', 'receipt-error']) test(`resume recovers the same attempt: ${scenario}`, () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-release-resume-running-'));
  const origin = join(root, 'origin.git');
  const code = join(root, 'code');
  const featureWorktree = join(root, '.worktrees', '06-recover', 'code');
  const reqDir = join(root, '.worktrees', '06-recover', 'docs', 'doc', '06.recover');
  mkdirSync(origin, { recursive: true });
  git(origin, ['init', '--bare']);
  git(root, ['clone', origin, code]);
  configure(code);
  git(code, ['checkout', '-b', 'master']);
  writeFileSync(join(code, 'base.txt'), 'base\n');
  git(code, ['add', 'base.txt']);
  git(code, ['commit', '-m', 'base']);
  git(code, ['push', '-u', 'origin', 'master']);
  git(code, ['checkout', '-b', 'test']);
  writeFileSync(join(code, 'test.txt'), 'test\n');
  git(code, ['add', 'test.txt']);
  git(code, ['commit', '-m', 'test']);
  git(code, ['push', '-u', 'origin', 'test']);
  git(code, ['worktree', 'add', '-b', 'feature/06-recover', featureWorktree, 'origin/master']);
  writeFileSync(join(featureWorktree, 'feature.txt'), 'feature\n');
  git(featureWorktree, ['add', 'feature.txt']);
  git(featureWorktree, ['commit', '-m', 'feature']);
  const sourceCommit = git(featureWorktree, ['rev-parse', 'HEAD']);
  const candidateRef = 'refs/cc-nexs/candidates/06-recover/code';
  git(code, ['update-ref', candidateRef, sourceCommit]);

  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'workspace.json'), `${JSON.stringify({
    version: 1,
    repositories: [{ id: 'code', path: 'code', base_branch: 'master', test_branch: 'test', release_order: 10 }],
  }, null, 2)}\n`);
  writeFileSync(join(root, 'cc-nexs.config.json'), `${JSON.stringify({
    workflow: { sprint_delivery: 'final_only', test_release: { policy: 'auto_if_ready' } },
    release: {
      test: {
        environment: 'test',
        driver: { command: 'node', args: ['recovery-driver.mjs'], timeout_seconds: 10 },
      },
    },
  }, null, 2)}\n`);
  writeFileSync(join(root, 'recovery-driver.mjs'), [
    "import { appendFileSync } from 'node:fs';",
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "for await (const chunk of process.stdin) input += chunk;",
    "const request = JSON.parse(input);",
    "appendFileSync('recovery-driver.log', JSON.stringify(request) + '\\n');",
    "const revision = Object.fromEntries(Object.entries(request.integrations).map(([id, value]) => [id, value.integrationCommit]));",
    "console.log(JSON.stringify({status:'succeeded',pipeline:{metadata:{run:6,provider:'ci'},id:request.attempt},deployment:{id:'deploy-6',environment:'test'},environment_revision:revision}));",
  ].join('\n'));

  mkdirSync(reqDir, { recursive: true });
  const progressFile = join(reqDir, 'progress.json');
  writeFileSync(join(reqDir, 'requirements.md'), '# Requirements\n');
  writeFileSync(join(reqDir, 'plan.md'), '# Plan\n\n<!-- APPROVAL-SCOPE START -->\n- risk_tier: low\n- delivery_lane: fast-track\n- test_delivery.code: deploy\n<!-- APPROVAL-SCOPE END -->\n');
  writeFileSync(join(reqDir, 'config.json'), '{"mode":"full","release":{"test":"inherit"}}\n');
  const progress = createProgressV2({ featureId: '06', featureSlug: 'recover', preset: 'preset-standard', mode: 'lean' });
  progress.state = 'TEST_RELEASE';
  progress.gates.plan = { approved: true, binding: gatewayATestBinding(reqDir, { code: 'test' }) };
  progress.repositories.code = {
    branch: 'feature/06-recover',
    worktree: '.worktrees/06-recover/code',
    base_branch: 'master',
    base_commit: git(code, ['rev-parse', 'origin/master']),
    candidate: { commit: null, ref: candidateRef, paths: ['feature.txt'] },
  };
  const source = { code: sourceCommit };
  progress.local_verification = {
    status: 'passed',
    context: 'implementation',
    candidate_fingerprint: candidateFingerprint(source),
    attempts: [{
      id: 'local-verify-1', status: 'passed', context: 'implementation',
      fingerprint: candidateFingerprint(source), source, evidence: [{ check: 'regression', result: 'passed', command: 'node --test regression.test.mjs', exit_code: 0, proof: 'regression passed' }],
      completed_at: new Date().toISOString(),
    }],
  };
  writeProgressV2(progressFile, progress);

  try {
    if (scenario === 'receipt-error') {
      const driverFile = join(root, 'recovery-driver.mjs');
      const validDriver = readFileSync(driverFile, 'utf8');
      writeFileSync(driverFile, "console.error('Missing authenticated exact-revision pipeline evidence'); process.exit(1);");
      assert.throws(() => runTestRelease({ cwd: root, featureId: '06', progressPath: progressFile }), /pipeline evidence/);
      assert.equal(readProgressV2(progressFile).delivery.test.status, 'awaiting_receipt');
      assert.throws(() => runTestRelease({ cwd: root, featureId: '06', progressPath: progressFile, retry: true }), /must be resumed/);
      writeFileSync(driverFile, validDriver);
      const resumed = runTestRelease({ cwd: root, featureId: '06', progressPath: progressFile, resume: true });
      assert.equal(resumed.attempt.status, 'succeeded');
      assert.equal(readProgressV2(progressFile).delivery.test.attempts.length, 1);
      const requests = readFileSync(join(root, 'recovery-driver.log'), 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(requests.map(request => request.operation), ['release_test_status']);
      return;
    }
    if (scenario === 'conflict') {
      writeFileSync(join(code, 'feature.txt'), 'test-only version\n');
      git(code, ['add', '.']); git(code, ['commit', '-m', 'test concurrent change']); git(code, ['push', 'origin', 'test']);
      const conflict = runTestRelease({ cwd: root, featureId: '06', progressPath: progressFile });
      assert.equal(conflict.status, 'conflicts');
      assert.equal(readProgressV2(progressFile).state, 'TEST_MERGE_CONFLICT');
      assert.throws(() => resolveTestConflict({ cwd: root, featureId: '06', progressPath: progressFile }), /unresolved/);
      writeFileSync(join(conflict.worktree, 'feature.txt'), 'feature and test-only version\n');
      git(conflict.worktree, ['add', 'feature.txt']);
      resolveTestConflict({ cwd: root, featureId: '06', progressPath: progressFile });
      const resumed = runTestRelease({ cwd: root, featureId: '06', progressPath: progressFile, resume: true });
      assert.equal(resumed.attempt.status, 'succeeded');
      assert.equal(readProgressV2(progressFile).delivery.test.attempts.length, 1);
      assert.equal(git(code, ['rev-parse', candidateRef]), sourceCommit);
      const requests = readFileSync(join(root, 'recovery-driver.log'), 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(requests.map(request => request.operation), ['release_test']);
      return;
    }
    if (scenario.startsWith('conflict-')) {
      const cli = join(dirname(new URL(import.meta.url).pathname), 'cc-nexs-cli.mjs');
      const runCli = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
      const remoteContains = (commit) => { git(code, ['fetch', 'origin']); try { git(code, ['merge-base', '--is-ancestor', commit, 'origin/test']); return true; } catch { return false; } };
      const conflictRoot = join(root, '.cc-nexs', 'runtime', 'test-conflicts', '06');
      writeFileSync(join(code, 'feature.txt'), 'test-only version\n');
      git(code, ['add', '.']); git(code, ['commit', '-m', 'test concurrent change']); git(code, ['push', 'origin', 'test']);
      const conflict = runTestRelease({ cwd: root, featureId: '06', progressPath: progressFile });
      assert.equal(conflict.status, 'conflicts');
      writeFileSync(join(conflict.worktree, 'feature.txt'), 'feature and test-only version\n');
      git(conflict.worktree, ['add', 'feature.txt']);
      let current = sourceCommit;
      if (scenario === 'conflict-invalidated') {
        // revise-hotfix / switch-test-target invalidate the attempt without changing this candidate.
        const invalidated = readProgressV2(progressFile);
        invalidated.delivery.test.attempts.at(-1).invalidated_at = new Date().toISOString();
        invalidated.delivery.test.status = 'idle';
        invalidated.state = 'TEST_RELEASE';
        writeProgressV2(progressFile, invalidated);
        const refused = runCli(['resolve-test-conflict', '06', '--progress', progressFile]);
        assert.equal(refused.status, 1);
        assert.match(refused.stderr, /invalidated/);
        assert.doesNotMatch(refused.stderr, /Usage:/);
      }
      if (scenario === 'conflict-superseded') {
        writeFileSync(join(featureWorktree, 'feature.txt'), 'feature v2\n');
        git(featureWorktree, ['commit', '-am', 'feature v2']);
        current = git(featureWorktree, ['rev-parse', 'HEAD']);
        git(code, ['update-ref', candidateRef, current]);
        const superseded = readProgressV2(progressFile);
        const next = { code: current };
        Object.assign(superseded.local_verification, { candidate_fingerprint: candidateFingerprint(next) });
        Object.assign(superseded.local_verification.attempts[0], { fingerprint: candidateFingerprint(next), source: next });
        // The repaired candidate returns through the fix flow, which does not invalidate attempts.
        superseded.state = 'TEST_RELEASE';
        writeProgressV2(progressFile, superseded);
        assert.throws(() => resolveTestConflict({ cwd: root, featureId: '06', progressPath: progressFile }), /previous candidate/);
      }
      if (scenario === 'conflict-target-advanced') {
        writeFileSync(join(code, 'other.txt'), 'another test change\n');
        git(code, ['add', 'other.txt']); git(code, ['commit', '-m', 'test advances again']); git(code, ['push', 'origin', 'test']);
        const advanced = runCli(['resolve-test-conflict', '06', '--progress', progressFile]);
        assert.equal(advanced.status, 0, advanced.stderr);
        assert.match(advanced.stdout, /target advanced/);
        const retired = readProgressV2(progressFile);
        assert.ok(retired.delivery.test.attempts[0].invalidated_at);
        assert.equal(retired.state, 'TEST_RELEASE');
        assert.equal(existsSync(conflict.worktree), false);
      }
      // No stale or rejected resolution reached the shared test branch.
      assert.equal(remoteContains(sourceCommit), false);

      const retried = runTestRelease({ cwd: root, featureId: '06', progressPath: progressFile });
      assert.equal(retried.status, 'conflicts');
      assert.equal(retried.attempt.id, 'test-release-2');
      assert.ok(readProgressV2(progressFile).delivery.test.attempts[0].invalidated_at);
      assert.equal(existsSync(join(conflictRoot, 'test-release-1')), false);
      assert.doesNotMatch(git(code, ['worktree', 'list', '--porcelain']), /test-release-1/);
      if (scenario === 'conflict-target-advanced') {
        // rerere replays the earlier resolution but still requires the developer to stage it.
        assert.equal(readFileSync(join(retried.worktree, 'feature.txt'), 'utf8'), 'feature and test-only version\n');
        assert.throws(() => resolveTestConflict({ cwd: root, featureId: '06', progressPath: progressFile }), /unresolved/);
      } else {
        writeFileSync(join(retried.worktree, 'feature.txt'), 'feature and test-only version\n');
      }
      git(retried.worktree, ['add', 'feature.txt']);
      const resolved = runCli(['resolve-test-conflict', '06', '--progress', progressFile]);
      assert.equal(resolved.status, 0, resolved.stderr);
      assert.match(resolved.stdout, /resolved and pushed/);
      assert.equal(existsSync(conflictRoot), false);
      const resumed = runTestRelease({ cwd: root, featureId: '06', progressPath: progressFile, resume: true });
      assert.equal(resumed.attempt.status, 'succeeded');
      assert.equal(remoteContains(current), true);
      return;
    }
    const started = beginTestRelease(progressFile, { source });
    const integration = integrateCandidateToTest({
      repo: code,
      repositoryId: 'code',
      candidateRef,
      expectedSourceCommit: sourceCommit,
      targetBranch: 'test',
    });
    recordTestIntegration(progressFile, {
      attemptId: started.attempt.id,
      repository: 'code',
      sourceCommit: integration.sourceCommit,
      targetBranch: integration.targetBranch,
      targetBefore: integration.targetBefore,
      integrationCommit: integration.remoteCommit || integration.integrationCommit,
    });
    if (scenario === 'failed') {
      completeTestRelease(progressFile, { attemptId: started.attempt.id, status: 'failed', reason: 'legacy driver receipt timeout' });
      appendProgressEvent(progressFile, { type: 'state.transition', from: 'TEST_RELEASE', to: 'TEST_RELEASE_BLOCKED' });
    }
    const beforeResume = readProgressV2(progressFile);
    const integrationEvidence = structuredClone(beforeResume.delivery.test.attempts[0].integrations.code);
    const remoteBeforeResume = git(code, ['rev-parse', 'origin/test']);

    const resumed = runTestRelease({ cwd: root, featureId: '06', progressPath: progressFile, resume: true });
    const recovered = readProgressV2(progressFile);
    assert.equal(resumed.reused, true);
    assert.equal(resumed.attempt.id, started.attempt.id);
    assert.equal(resumed.attempt.status, 'succeeded');
    assert.equal(recovered.delivery.test.attempts.length, 1);
    assert.deepEqual(recovered.delivery.test.attempts[0].integrations.code, integrationEvidence);
    assert.equal(git(code, ['rev-parse', 'origin/test']), remoteBeforeResume);
    assert.equal(recovered.events.filter((event) => event.type === 'delivery.test.repository_integrated').length, 1);
    const requests = readFileSync(join(root, 'recovery-driver.log'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(requests.map(({ operation, attempt }) => ({ operation, attempt })), [{
      operation: 'release_test_status', attempt: started.attempt.id,
    }]);
    assert.equal(requests[0].previous.status, scenario === 'failed' ? 'awaiting_receipt' : 'running');
    assert.equal(requests[0].previous.pipeline, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('test release driver fails closed on invalid output, process failure, timeout, and missing evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-release-driver-'));
  const payload = { attempt: 'test-release-1', environment: 'test' };
  const run = (source, timeoutMs = 1000) => {
    const file = join(root, `driver-${Math.random().toString(16).slice(2)}.mjs`);
    writeFileSync(file, source);
    return () => invokeTestReleaseDriver({
      workspaceRoot: root,
      driver: { command: process.execPath, args: [file], timeoutMs },
      payload,
    });
  };
  try {
    assert.throws(run("console.log('not json')"), /must write one JSON object/);
    assert.throws(run("console.error('driver exploded'); process.exit(2)"), /driver exploded|driver failed/);
    assert.equal(run("await new Promise((resolve) => setTimeout(resolve, 500));", 50)().status, 'awaiting_receipt');
    assert.equal(run("console.error('Authenticated CI receipt unavailable; resume this exact attempt'); process.exit(1)")().status, 'awaiting_receipt');
    assert.throws(
      run("console.log(JSON.stringify({status:'succeeded', pipeline:{id:'p'}}))"),
      /requires pipeline, deployment, and environment_revision/,
    );
    assert.throws(
      run("console.log(JSON.stringify({status:'pending'}))"),
      /pending release driver output requires pipeline evidence/,
    );
    assert.throws(
      run("console.log(JSON.stringify({status:'succeeded', pipeline:{}, deployment:{}, environment_revision:{}}))"),
      /requires pipeline, deployment, and environment_revision/,
    );
    assert.throws(
      run("console.log(JSON.stringify({status:'succeeded', pipeline:{id:'p'}, deployment:{id:'d',environment:'production'}, environment_revision:{api:'merge'}}))"),
      /does not match the requested test environment/,
    );
    const mismatchedPayload = {
      attempt: 'test-release-1', environment: 'test',
      integrations: { api: { integrationCommit: 'merge-expected' } },
    };
    const mismatchedDriver = join(root, 'driver-mismatched.mjs');
    writeFileSync(mismatchedDriver, "console.log(JSON.stringify({status:'succeeded',pipeline:{id:'p'},deployment:{id:'d',environment:'test'},environment_revision:{api:'merge-old'}}));\n");
    assert.throws(() => invokeTestReleaseDriver({
      workspaceRoot: root,
      driver: { command: process.execPath, args: [mismatchedDriver], timeoutMs: 1000 },
      payload: mismatchedPayload,
    }), /does not match the integrated commit/);

    const reorderedPipeline = {
      operation: 'release_test_status',
      attempt: 'test-release-1',
      environment: 'test',
      integrations: {},
      previous: { pipeline: { id: 'p1', metadata: { provider: 'ci', run: 7 } } },
    };
    assert.doesNotThrow(runWithPayload(
      "console.log(JSON.stringify({status:'pending',pipeline:{metadata:{run:7,provider:'ci'},id:'p1'}}));\n",
      reorderedPipeline,
    ));
    assert.throws(runWithPayload(
      "console.log(JSON.stringify({status:'pending',pipeline:{metadata:{run:8,provider:'ci'},id:'p1'}}));\n",
      reorderedPipeline,
    ), /changed pipeline identity/);
    assert.throws(runWithPayload(
      "console.log(JSON.stringify({status:'pending'}));\n",
      { ...reorderedPipeline, previous: { pipeline: null } },
    ), /must discover and return pipeline evidence/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  function runWithPayload(source, driverPayload) {
    const file = join(root, `driver-${Math.random().toString(16).slice(2)}.mjs`);
    writeFileSync(file, source);
    return () => invokeTestReleaseDriver({
      workspaceRoot: root,
      driver: { command: process.execPath, args: [file], timeoutMs: 1000 },
      payload: driverPayload,
    });
  }
});


test('test target rejects production and driver injection', () => {
  const target = { kind: 'test', environment: 'test02', branches: { api: 'test02' }, allowed_hosts: ['test.example.com'], app_url: 'https://test.example.com', operations_url: 'https://test.example.com' };
  const repos = [{ id: 'api', base_branch: 'main' }];
  validateTestTarget(target, repos, ['api']);
  for (const invalid of [{ ...target, environment: 'production' }, { ...target, branches: { api: 'main' } }, { ...target, driver: { command: 'evil' } }, { ...target, app_url: 'https://live.example.com' }]) assert.throws(() => validateTestTarget(invalid, repos, ['api']));
});
