import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { acceptanceCheckIds, insertVerificationSection, mergeShardResults, renderShardedVerification } from './verification-shards.mjs';
import { readVerifyGuide } from './verify-guide.mjs';

const shard = (name, result, checks) => ({ shard: name, result, checks, evidence: checks.map((check) => ({ check, result: result === 'blocked' ? 'failed' : 'passed', proof: `${check} proof` })) });

test('acceptance checks come from the TV rows of the approval scope', () => {
  assert.deepEqual(acceptanceCheckIds('| TV-001 | AC-001 | open | ok |\n| TV-002 | AC-002 | x | y |\n| LV-001 | AC-001 |\n| TV-001 | dup |'), ['TV-001', 'TV-002']);
});

test('shard results merge into one conclusion that any blocked shard decides', () => {
  const required = ['TV-001', 'TV-002', 'TV-003'];
  const passed = mergeShardResults([shard('web', 'passed', ['TV-001', 'TV-002']), shard('api', 'passed', ['TV-003'])], { requiredChecks: required });
  assert.equal(passed.status, 'passed');
  assert.deepEqual(passed.evidence.map((item) => `${item.shard}:${item.check}`), ['web:TV-001', 'web:TV-002', 'api:TV-003']);
  assert.equal(mergeShardResults([shard('web', 'manual_required', ['TV-001', 'TV-002']), shard('api', 'passed', ['TV-003'])], { requiredChecks: required }).status, 'manual_required');
  assert.equal(mergeShardResults([shard('web', 'manual_required', ['TV-001', 'TV-002']), shard('api', 'blocked', ['TV-003'])], { requiredChecks: required }).status, 'blocked');
});

test('shard results fail closed on gaps, duplicates, and unreported checks', () => {
  const required = ['TV-001', 'TV-002'];
  assert.throws(() => mergeShardResults([shard('web', 'passed', ['TV-001'])]), /at least two shard results/);
  assert.throws(() => mergeShardResults([shard('web', 'passed', ['TV-001']), shard('api', 'passed', ['probe:F-1'])], { requiredChecks: required }), /no shard was assigned TV-002/);
  assert.throws(() => mergeShardResults([shard('web', 'passed', ['TV-001']), shard('web', 'passed', ['TV-002'])], { requiredChecks: required }), /duplicate shard: web/);
  assert.throws(() => mergeShardResults([shard('web', 'passed', ['TV-001']), { ...shard('api', 'passed', ['TV-002']), checks: ['TV-002', 'TV-009'] }], { requiredChecks: required }), /api has no evidence for TV-009/);
  assert.throws(() => mergeShardResults([shard('web', 'ok', ['TV-001']), shard('api', 'passed', ['TV-002'])]), /must be passed, blocked, or manual_required/);
});

test('the merged section lands under the Test acceptance heading in any template language', () => {
  const section = renderShardedVerification({
    attemptId: 'test-release-2',
    environmentRevision: { api: 'abcdef1234567890' },
    status: 'blocked',
    evidence: [{ shard: 'api', check: 'TV-001', result: 'failed', proof: 'HTTP 500 | body\nline 2' }],
  });
  assert.match(section, /\| api \| TV-001 \| failed \| HTTP 500 \\\| body line 2 \|/);
  assert.match(section, /api@abcdef123456/);
  assert.match(section, /测试结论: 阻塞\n/);
  for (const heading of ['## Test 环境验收', '## Test 環境驗收', '## Test Environment Acceptance']) {
    const merged = insertVerificationSection(`# Plan\n\n${heading}\n\n| old |\n\n## Final AC\n`, section);
    assert.ok(merged.indexOf('### test-release-2') > merged.indexOf(heading));
    assert.ok(merged.indexOf('### test-release-2') < merged.indexOf('## Final AC'));
  }
  assert.ok(insertVerificationSection('# Plan\n', section).endsWith(section));
});

test('verification guides and feature maps are read from the exact candidate commit', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cc-nexs-verify-guide-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'Guide Test');
    git('config', 'user.email', 'guide@example.com');
    writeFileSync(join(repo, 'app.txt'), 'app\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    const without = git('rev-parse', 'HEAD');
    mkdirSync(join(repo, '.cc-nexs/verify/features'), { recursive: true });
    writeFileSync(join(repo, '.cc-nexs/verify/README.md'), '# Verify app\n');
    writeFileSync(join(repo, '.cc-nexs/verify/features/README.md'), '# Features\n');
    writeFileSync(join(repo, '.cc-nexs/verify/features/report-export.md'), '# Export\n');
    writeFileSync(join(repo, '.cc-nexs/verify/features/login.md'), '# Login\n');
    git('add', '.');
    git('commit', '-qm', 'guide');
    const withGuide = git('rev-parse', 'HEAD');
    assert.deepEqual(readVerifyGuide(repo, without), { guide: null, features: [] });
    assert.deepEqual(readVerifyGuide(repo, withGuide), { guide: '.cc-nexs/verify/README.md', features: ['login', 'report-export'] });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
