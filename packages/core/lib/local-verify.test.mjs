import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runLocalVerification } from './local-verify.mjs';
import { planApprovalBinding } from './plan-contract.mjs';
import {
  beginTestRelease,
  completeTestRelease,
  createProgressV2,
  readProgressV2,
  recordTestVerification,
  writeProgressV2,
} from './progress-v2.mjs';
import { recordLeanReview } from './review-control.mjs';
import { runCcNexsCommand } from './cc-nexs-cli.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('Lean local verification invokes the configured driver and binds evidence to candidate SHA', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-local-verify-'));
  const api = join(root, 'api');
  const docs = join(root, 'docs', 'doc', '30.local-verify');
  const driver = join(root, 'verify-driver.mjs');
  try {
    mkdirSync(join(root, '.cc-nexs'), { recursive: true });
    mkdirSync(api, { recursive: true });
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), [
      'version: 1',
      'docs_repository: docs',
      'repositories:',
      '  - id: docs',
      '    path: docs',
      '    docs: true',
      '  - id: api',
      '    path: api',
      '    base_branch: main',
      '    test_branch: test',
    ].join('\n'));
    writeFileSync(driver, [
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  const payload = JSON.parse(input);",
      "  process.stdout.write(JSON.stringify({ status: 'passed', evidence: [`candidate:${payload.source.api}`, 'build', 'start', 'smoke'] }));",
      "});",
    ].join('\n'));
    writeFileSync(join(root, 'cc-nexs.config.json'), JSON.stringify({
      workflow: { local_verify: { driver: { command: process.execPath, args: [driver], timeout_seconds: 30 } } },
    }, null, 2));

    git(api, ['init', '-b', 'main']);
    git(api, ['config', 'user.name', 'Test User']);
    git(api, ['config', 'user.email', 'test@example.com']);
    writeFileSync(join(api, 'app.txt'), 'ready\n');
    git(api, ['add', 'app.txt']);
    git(api, ['commit', '-m', 'initial']);
    const commit = git(api, ['rev-parse', 'HEAD']);
    const candidateRef = 'refs/cc-nexs/candidates/30-local-verify/api';
    git(api, ['update-ref', candidateRef, commit]);

    writeFileSync(join(docs, 'requirements.md'), '# Requirements\n\n- AC-001\n');
    writeFileSync(join(docs, 'plan.md'), [
      '# Plan',
      '<!-- APPROVAL-SCOPE START -->',
      '- T-001',
      '<!-- APPROVAL-SCOPE END -->',
      '',
    ].join('\n'));
    writeFileSync(join(docs, 'progress.md'), '## 当前状态\n\n```yaml\ncurrent_state: IMPLEMENTING\nupdated_at: null\n```\n\n## 历史轨迹\n\n- (尚无)\n');
    const progress = createProgressV2({ featureId: '30', featureSlug: 'local-verify', preset: 'preset-standard' });
    progress.state = 'IMPLEMENTING';
    progress.gates.plan = { approved: true, binding: planApprovalBinding(docs) };
    progress.repositories.api = {
      branch: 'feature/30-local-verify',
      worktree: 'api',
      candidate: { commit, ref: candidateRef, paths: ['app.txt'] },
    };
    const progressFile = join(docs, 'progress.json');
    writeProgressV2(progressFile, progress);

    const result = runLocalVerification({ cwd: root, featureId: '30', progressPath: progressFile });
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.source, { api: commit });
    assert.deepEqual(result.evidence.slice(1), ['build', 'start', 'smoke']);
    assert.equal(result.context, 'implementation');
    assert.equal(readProgressV2(progressFile).local_verification.status, 'passed');
    assert.equal(readProgressV2(progressFile).local_verification.context, 'implementation');

    const reused = runLocalVerification({ cwd: root, featureId: '30', progressPath: progressFile });
    assert.equal(reused.reused, true);
    assert.equal(readProgressV2(progressFile).local_verification.attempts.length, 1);

    const testRepair = readProgressV2(progressFile);
    testRepair.state = 'TEST_FIXING';
    writeProgressV2(progressFile, testRepair);
    const testReverify = runLocalVerification({ cwd: root, featureId: '30', progressPath: progressFile });
    assert.equal(testReverify.reused, undefined);
    assert.equal(testReverify.context, 'test');
    assert.equal(readProgressV2(progressFile).local_verification.context, 'test');
    assert.equal(readProgressV2(progressFile).local_verification.attempts.length, 2);

    writeFileSync(join(docs, 'requirements.md'), '# Requirements\n\n- changed AC\n');
    assert.throws(
      () => runLocalVerification({ cwd: root, featureId: '30', progressPath: progressFile }),
      /changed after Gateway A/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Lean local verification can defer an environment-only backend start to test', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-local-verify-deferred-'));
  const api = join(root, 'api');
  const docs = join(root, 'docs', 'doc', '31.local-verify-deferred');
  try {
    mkdirSync(join(root, '.cc-nexs'), { recursive: true });
    mkdirSync(api, { recursive: true });
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), [
      'version: 1',
      'docs_repository: docs',
      'repositories:',
      '  - id: docs',
      '    path: docs',
      '    docs: true',
      '  - id: api',
      '    path: api',
      '    base_branch: main',
      '    test_branch: test',
    ].join('\n'));
    writeFileSync(join(root, 'cc-nexs.config.json'), '{}\n');

    git(api, ['init', '-b', 'main']);
    git(api, ['config', 'user.name', 'Test User']);
    git(api, ['config', 'user.email', 'test@example.com']);
    writeFileSync(join(api, 'app.txt'), 'ready\n');
    git(api, ['add', 'app.txt']);
    git(api, ['commit', '-m', 'initial']);
    const commit = git(api, ['rev-parse', 'HEAD']);
    const candidateRef = 'refs/cc-nexs/candidates/31-local-verify-deferred/api';
    git(api, ['update-ref', candidateRef, commit]);

    writeFileSync(join(docs, 'requirements.md'), '# Requirements\n\n- AC-001\n');
    writeFileSync(join(docs, 'plan.md'), [
      '# Plan',
      '<!-- APPROVAL-SCOPE START -->',
      '- risk_tier: medium',
      '- delivery_lane: fast-track',
      '<!-- APPROVAL-SCOPE END -->',
      '',
    ].join('\n'));
    writeFileSync(join(docs, 'progress.md'), '## 当前状态\n\n```yaml\ncurrent_state: IMPLEMENTING\nupdated_at: null\n```\n\n## 历史轨迹\n\n- (尚无)\n');
    const progress = createProgressV2({ featureId: '31', featureSlug: 'local-verify-deferred', preset: 'preset-standard' });
    progress.state = 'IMPLEMENTING';
    progress.gates.plan = { approved: true, binding: planApprovalBinding(docs) };
    progress.repositories.api = {
      branch: 'feature/31-local-verify-deferred',
      worktree: 'api',
      candidate: { commit, ref: candidateRef, paths: ['app.txt'] },
    };
    const progressFile = join(docs, 'progress.json');
    writeProgressV2(progressFile, progress);

    assert.throws(
      () => runLocalVerification({ cwd: root, featureId: '31', progressPath: progressFile }),
      /local_verify\.driver is not configured/,
    );
    assert.throws(() => runLocalVerification({
      cwd: root,
      featureId: '31',
      progressPath: progressFile,
      recordStatus: 'deferred_to_test',
      evidence: [{
        check: 'backend-start', result: 'deferred_to_test',
        reason: 'required infrastructure is unavailable locally',
        test_action: 'deploy backend candidate to test and run API smoke',
      }],
    }), /requires at least one passed command/);
    const failed = runCcNexsCommand([
      'verify-local', '31', '--failed',
      '--evidence-json', JSON.stringify({
        check: 'backend-compile', result: 'failed', command: 'mvn -q -DskipTests package', exit_code: 1,
        proof: 'COMPILATION ERROR in UploadService.java:42',
      }),
      '--progress', progressFile,
    ], { cwd: root });
    assert.equal(failed.status, 'failed');
    assert.equal(readProgressV2(progressFile).local_verification.status, 'failed');
    assert.throws(() => runCcNexsCommand([
      'verify-local', '31', '--failed',
      '--evidence-json', JSON.stringify({
        check: 'backend-compile', result: 'failed', command: 'mvn package', exit_code: 0, proof: 'not a failure',
      }),
      '--progress', progressFile,
    ], { cwd: root }), /nonzero integer exit_code/);
    const passedEvidence = {
      check: 'backend-compile', result: 'passed', command: 'mvn -q -DskipTests package', exit_code: 0,
      proof: 'BUILD SUCCESS',
    };
    const deferredEvidence = {
      check: 'backend-start', result: 'deferred_to_test',
      reason: 'required infrastructure is unavailable locally',
      test_action: 'deploy backend candidate to test and run API smoke',
    };
    const result = runCcNexsCommand([
      'verify-local', '31', '--deferred-to-test',
      '--evidence-json', JSON.stringify(passedEvidence),
      '--evidence-json', JSON.stringify(deferredEvidence),
      '--progress', progressFile,
    ], { cwd: root });
    assert.equal(result.status, 'deferred_to_test');
    assert.equal(readProgressV2(progressFile).local_verification.status, 'deferred_to_test');
    const reused = runLocalVerification({ cwd: root, featureId: '31', progressPath: progressFile });
    assert.equal(reused.reused, true);
    assert.equal(reused.status, 'deferred_to_test');

    const release = beginTestRelease(progressFile, { source: result.source });
    completeTestRelease(progressFile, {
      attemptId: release.attempt.id,
      status: 'succeeded',
      pipeline: { id: 'pipeline-31' },
      deployment: { environment: 'test' },
      environmentRevision: { api: commit },
    });
    recordTestVerification(progressFile, {
      attemptId: release.attempt.id,
      result: 'passed',
      evidence: [{
        check: 'backend-start', result: 'passed',
        proof: 'deployed API smoke returned 200',
      }],
    });
    const tested = readProgressV2(progressFile);
    tested.state = 'TEST_VERIFIED';
    writeProgressV2(progressFile, tested);
    recordLeanReview({ cwd: root, featureId: '31', progressPath: progressFile, status: 'passed' });
    assert.equal(readProgressV2(progressFile).review.status, 'passed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
