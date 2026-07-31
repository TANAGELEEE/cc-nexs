import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createProgressV2, readProgressV2, writeProgressV2 } from './progress-v2.mjs';
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

  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'workspace.json'), `${JSON.stringify({
    version: 1,
    repositories: [
      { id: 'code', path: 'code', base_branch: 'master', test_branch: 'test', release_order: 10 },
      { id: 'other', path: 'other', base_branch: 'master', test_branch: 'test', release_order: 20 },
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
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "for await (const chunk of process.stdin) input += chunk;",
    "const request = JSON.parse(input);",
    "const revision = Object.fromEntries(Object.entries(request.integrations).map(([id, value]) => [id, value.integrationCommit]));",
    "console.log(JSON.stringify({ status: 'succeeded', pipeline: { id: 'pipeline-1', url: 'https://ci.example/pipeline-1' }, deployment: { id: 'deploy-1', environment: 'test' }, environment_revision: revision }));",
  ].join('\n'));
  mkdirSync(reqDir, { recursive: true });
  const progressFile = join(reqDir, 'progress.json');
  const progress = createProgressV2({ featureId: '05', featureSlug: 'demo', preset: 'preset-standard', mode: 'full' });
  progress.state = 'TEST_RELEASE';
  progress.repositories.code = {
    branch: 'feature/05-demo',
    worktree: '.worktrees/05-demo/code',
    base_branch: 'master',
    base_commit: git(code, ['rev-parse', 'origin/master']),
    candidate: { commit: null, ref: candidateRef, paths: ['feature.txt'] },
  };
  progress.repositories.other = {
    branch: 'feature/05-demo',
    worktree: '.worktrees/05-demo/other',
    base_branch: 'master',
    base_commit: null,
    candidate: null,
  };
  writeProgressV2(progressFile, progress);
  writeFileSync(join(reqDir, 'config.json'), '{"mode":"full","release":{"test":"inherit"}}\n');

  try {
    assert.throws(
      () => runCcNexsCommand(['release-test', '05', '--dry-run', '--progress', progressFile], { cwd: root }),
      /assigned repository other is missing a candidate ref/,
    );
    const completeProgress = readProgressV2(progressFile);
    delete completeProgress.repositories.other;
    writeProgressV2(progressFile, completeProgress);

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
    assert.throws(
      () => runCcNexsCommand(['release-test', '05', '--dry-run', '--progress', progressFile], { cwd: root }),
      /release\.test\.operations_url is required/,
    );
    writeFileSync(projectConfigFile, `${JSON.stringify(projectConfig, null, 2)}\n`);

    assert.throws(
      () => runCcNexsCommand(['release-test', '05', '--dry-run', '--hotfix', '--progress', progressFile], { cwd: root }),
      /--hotfix requires mode hotfix/,
    );

    const dryRun = runCcNexsCommand(['release-test', '05', '--dry-run', '--progress', progressFile], { cwd: root });
    assert.equal(dryRun.dryRun, true);
    assert.equal(readProgressV2(progressFile).delivery.test.attempts.length, 0);
    assert.throws(() => git(code, ['show', 'origin/test:feature.txt']));

    assert.throws(
      () => runTestRelease({ cwd: root, featureId: '05', progressPath: progressFile }),
      /browser capability preflight must be attested/,
    );
    const result = runTestRelease({ cwd: root, featureId: '05', progressPath: progressFile, capabilityAttested: true });
    assert.equal(result.attempt.status, 'succeeded');
    assert.equal(git(code, ['show', 'origin/test:feature.txt']), 'feature');
    assert.equal(git(code, ['show', 'origin/test:test.txt']), 'test');
    const featureHead = git(featureWorktree, ['rev-parse', 'HEAD']);
    assert.equal(featureHead, sourceCommit);

    const saved = readProgressV2(progressFile);
    assert.equal(saved.delivery.test.attempts.length, 1);
    assert.equal(saved.delivery.test.attempts[0].pipeline.id, 'pipeline-1');
    assert.equal(saved.delivery.test.attempts[0].integrations.code.sourceCommit, sourceCommit);

    const repeated = runTestRelease({ cwd: root, featureId: '05', progressPath: progressFile, capabilityAttested: true });
    assert.equal(repeated.reused, true);
    assert.equal(readProgressV2(progressFile).delivery.test.attempts.length, 1);
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
    assert.throws(run("await new Promise((resolve) => setTimeout(resolve, 500));", 50), /driver failed/);
    assert.throws(
      run("console.log(JSON.stringify({status:'succeeded', pipeline:{id:'p'}}))"),
      /requires pipeline, deployment, and environment_revision/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
