import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { invokeLocalVerifyDriver, runLocalVerification } from './local-verify.mjs';
import { hotfixScopeBinding } from './hotfix-contract.mjs';
import { extractLocalVerificationChecks } from './local-evidence.mjs';
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
      "import { execFileSync } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  const payload = JSON.parse(input);",
      "  const proof = execFileSync('git', ['show', 'HEAD:app.txt'], { cwd: payload.repositories.api.worktree, encoding: 'utf8' }).trim();",
      "  if (process.argv.includes('--dirty')) writeFileSync(join(payload.repositories.api.worktree, 'app.txt'), 'modified by driver');",
      "  process.stdout.write(JSON.stringify({ status: 'passed', evidence: [{ check: 'LV-001', result: 'passed', command: 'git show HEAD:app.txt', exit_code: 0, proof }] }));",
      "});",
    ].join('\n'));
    writeFileSync(join(root, 'cc-nexs.config.json'), JSON.stringify({
      workflow: { local_verify: { driver: { command: process.execPath, args: [driver], timeout_seconds: 30 } } },
    }, null, 2));

    git(api, ['init', '-b', 'feature/30-local-verify']);
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
      '| Check | AC | 类型 | 命令/Driver | 通过条件 |',
      '|---|---|---|---|---|',
      '| LV-001 | AC-001 | smoke | git show HEAD:app.txt | ready |',
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
    assert.equal(result.evidence[0].check, 'LV-001');
    assert.equal(result.evidence[0].proof, 'ready');
    assert.equal(result.context, 'implementation');
    assert.equal(readProgressV2(progressFile).local_verification.status, 'passed');
    assert.equal(readProgressV2(progressFile).local_verification.context, 'implementation');
    const beforeReview = readProgressV2(progressFile);
    const invalidReviewEvidence = structuredClone(beforeReview);
    invalidReviewEvidence.state = 'LOCAL_VERIFYING';
    invalidReviewEvidence.local_verification.attempts.at(-1).evidence = [];
    writeProgressV2(progressFile, invalidReviewEvidence);
    assert.throws(() => recordLeanReview({ cwd: root, featureId: '30', progressPath: progressFile, status: 'passed' }), /structured evidence/);
    invalidReviewEvidence.local_verification.attempts.at(-1).evidence = [{ ...result.evidence[0], command: 'unrelated-test' }];
    writeProgressV2(progressFile, invalidReviewEvidence);
    assert.throws(() => recordLeanReview({ cwd: root, featureId: '30', progressPath: progressFile, status: 'passed' }), /does not match the bound matrix/);
    invalidReviewEvidence.local_verification.attempts.at(-1).evidence = [result.evidence[0], {
      type: 'p3_boundary', check: 'failed-smoke', result: 'failed', command: 'node smoke.mjs', exit_code: 1, proof: 'smoke failed',
    }];
    writeProgressV2(progressFile, invalidReviewEvidence);
    assert.throws(() => recordLeanReview({ cwd: root, featureId: '30', progressPath: progressFile, status: 'passed' }), /may contain only passed evidence/);

    writeProgressV2(progressFile, beforeReview);


    const reused = runLocalVerification({ cwd: root, featureId: '30', progressPath: progressFile });
    assert.equal(reused.reused, true);
    assert.equal(readProgressV2(progressFile).local_verification.attempts.length, 1);
    writeFileSync(join(api, 'app.txt'), 'uncommitted edit\n');
    assert.throws(() => runLocalVerification({ cwd: root, featureId: '30', progressPath: progressFile }), /worktree must be clean at exact candidate/);
    writeFileSync(join(api, 'app.txt'), 'ready\n');
    writeFileSync(join(root, 'cc-nexs.config.json'), JSON.stringify({
      workflow: { local_verify: { driver: { command: process.execPath, args: [driver, '--reconfigured'], timeout_seconds: 30 } } },
    }));
    assert.equal(runLocalVerification({ cwd: root, featureId: '30', progressPath: progressFile }).reused, undefined);
    assert.equal(readProgressV2(progressFile).local_verification.attempts.length, 2);


    const testRepair = readProgressV2(progressFile);
    testRepair.state = 'TEST_FIXING';
    writeProgressV2(progressFile, testRepair);
    const testReverify = runLocalVerification({ cwd: root, featureId: '30', progressPath: progressFile });
    assert.equal(testReverify.reused, undefined);
    assert.equal(testReverify.context, 'test');
    assert.equal(readProgressV2(progressFile).local_verification.context, 'test');
    assert.equal(readProgressV2(progressFile).local_verification.attempts.length, 3);

    const legacy = readProgressV2(progressFile);
    legacy.local_verification.attempts.at(-1).evidence = [];
    writeProgressV2(progressFile, legacy);
    assert.equal(runLocalVerification({ cwd: root, featureId: '30', progressPath: progressFile }).reused, undefined);

    const beforeDirtyDriver = readProgressV2(progressFile).revision;
    writeFileSync(join(root, 'cc-nexs.config.json'), JSON.stringify({
      workflow: { local_verify: { driver: { command: process.execPath, args: [driver, '--dirty'], timeout_seconds: 30 } } },
    }));
    assert.throws(() => runLocalVerification({ cwd: root, featureId: '30', progressPath: progressFile }), /worktree must be clean at exact candidate/);
    assert.equal(readProgressV2(progressFile).revision, beforeDirtyDriver);
    writeFileSync(join(api, 'app.txt'), 'ready\n');

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

    git(api, ['init', '-b', 'feature/31-local-verify-deferred']);
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
      attemptId: release.attempt.id, result: 'manual_required', evidence: ['test account blocked by missing role'],
    });
    const manual = readProgressV2(progressFile);
    manual.state = 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY';
    writeProgressV2(progressFile, manual);
    const incomplete = structuredClone(manual);
    delete incomplete.delivery.test.attempts.at(-1).deployment;
    writeProgressV2(progressFile, incomplete);
    assert.throws(() => recordLeanReview({ cwd: root, featureId: '31', progressPath: progressFile, status: 'passed' }), /deployed manual-verification attempt/);
    writeProgressV2(progressFile, manual);
    recordLeanReview({ cwd: root, featureId: '31', progressPath: progressFile, status: 'passed' });
    assert.equal(readProgressV2(progressFile).delivery.test.attempts.at(-1).verification.result, 'manual_required');

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

    writeFileSync(join(docs, 'hotfix.md'), [
      '<!-- HOTFIX-SCOPE START -->',
      '- severity: P2',
      '- related_feature: -',
      '- intended_paths: api/app.txt',
      '- acceptance_contract_change: no',
      '- api_contract_change: no',
      '- database_schema_change: no',
      '- permission_model_change: no',
      '- broad_refactor: no',
      '- non_behavioral_change: no',
      '| Check | AC | 类型 | 命令/Driver | 通过条件 |',
      '|---|---|---|---|---|',
      '| backend-compile | BUG-001 | regression | mvn -q -DskipTests package | BUILD SUCCESS |',
      '<!-- HOTFIX-SCOPE END -->',
    ].join('\n'));
    const hotfix = readProgressV2(progressFile);
    hotfix.mode = 'hotfix';
    hotfix.state = 'HOTFIX_IMPLEMENTED';
    hotfix.hotfix = { severity: 'P2', review_required: true, related_feature: null, scope_binding: hotfixScopeBinding(docs) };
    hotfix.repositories.api.base_commit = commit;
    writeProgressV2(progressFile, hotfix);
    const direct = (recordStatus, evidence) => runLocalVerification({
      cwd: root, featureId: '31', progressPath: progressFile, recordStatus, evidence,
    });
    assert.throws(() => direct('deferred_to_test', [passedEvidence, deferredEvidence]), /invalid local verification status/);
    assert.throws(() => direct('passed', [{ ...passedEvidence, check: 'unrelated-test' }]), /must cover bound checks/);
    assert.throws(() => direct('passed', [{ ...passedEvidence, command: 'npm test unrelated' }]), /does not match the bound matrix/);
    assert.equal(direct('passed', [passedEvidence]).status, 'passed');
    writeFileSync(join(docs, 'hotfix.md'), '<!-- HOTFIX-SCOPE START -->\n- severity: P1\n<!-- HOTFIX-SCOPE END -->');
    assert.throws(() => direct('passed', [passedEvidence]), /hotfix|must be no/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('local verification driver rejects empty, contradictory, incomplete, and unrelated success evidence', () => {
  const passed = { check: 'LV-001', result: 'passed', command: 'node --test bug.test.mjs', exit_code: 0, proof: '1 test passed' };
  const policy = { allow_test_defer: false, expected_checks: [{ check: passed.check, command: passed.command }] };
  for (const evidence of [[], ['smoke'], [{ ...passed, result: 'failed', exit_code: 1 }], [{ ...passed, proof: '' }],
    [{ ...passed, check: 'unrelated' }], [{ ...passed, command: 'node --test unrelated.test.mjs' }]]) {
    assert.throws(() => invokeLocalVerifyDriver({
      workspaceRoot: process.cwd(), payload: { feature: { id: 'test' }, policy },
      driver: { command: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(JSON.stringify({ status: 'passed', evidence }))})`], timeoutMs: 5000 },
    }), /local verification|local evidence/);
  }
  assert.throws(() => extractLocalVerificationChecks('| Check | Command |\n|---|---|\n| LV-001 | |'), /unique Check IDs and exact nonempty commands/);
  assert.deepEqual(extractLocalVerificationChecks('| Check | Command |\n|---|---|\n| LV-001 | `test ready \\|\\| exit 1` |'), [{ check: 'LV-001', command: 'test ready || exit 1' }]);
});
