import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runLocalVerification } from './local-verify.mjs';
import { planApprovalBinding } from './plan-contract.mjs';
import { createProgressV2, readProgressV2, writeProgressV2 } from './progress-v2.mjs';

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
    testRepair.local_verification = {
      status: 'idle', context: null, candidate_fingerprint: null,
      attempts: testRepair.local_verification.attempts,
    };
    writeProgressV2(progressFile, testRepair);
    const testReverify = runLocalVerification({ cwd: root, featureId: '30', progressPath: progressFile });
    assert.equal(testReverify.context, 'test');
    assert.equal(readProgressV2(progressFile).local_verification.context, 'test');

    writeFileSync(join(docs, 'requirements.md'), '# Requirements\n\n- changed AC\n');
    assert.throws(
      () => runLocalVerification({ cwd: root, featureId: '30', progressPath: progressFile }),
      /changed after Gateway A/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
