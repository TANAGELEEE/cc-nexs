import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertHotfixCandidate, startHotfix } from './hotfix-control.mjs';
import { candidateFingerprint, createProgressV2, readProgressV2, writeProgressV2 } from './progress-v2.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('start-hotfix binds an independent scope and advances INIT deterministically', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-hotfix-start-'));
  try {
    mkdirSync(join(root, '.cc-nexs'), { recursive: true });
    writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), 'version: 1\n');
    const docs = join(root, 'all-docs', 'doc', '31.payment-fix');
    mkdirSync(docs, { recursive: true });
    const progressFile = join(docs, 'progress.json');
    writeProgressV2(progressFile, createProgressV2({ featureId: '31', featureSlug: 'payment-fix', preset: 'preset-standard', mode: 'hotfix' }));
    writeFileSync(join(docs, 'progress.md'), '# progress\n');
    writeFileSync(join(docs, 'hotfix.md'), [
      '<!-- HOTFIX-SCOPE START -->',
      '- severity: P1',
      '- related_feature: 09',
      '- intended_paths: api/src/payment.ts',
      '- acceptance_contract_change: no',
      '- api_contract_change: no',
      '- database_schema_change: no',
      '- permission_model_change: no',
      '- broad_refactor: no',
      '- non_behavioral_change: no',
      '<!-- HOTFIX-SCOPE END -->',
    ].join('\n'));

    assert.throws(() => startHotfix({ cwd: root, featureId: '31', severity: 'P2' }), /does not match/);
    const result = startHotfix({ cwd: root, featureId: '31', severity: 'P1', relatedFeature: '09' });
    const saved = readProgressV2(progressFile);
    assert.equal(result.state, 'HOTFIX_IMPLEMENTING');
    assert.equal(saved.hotfix.severity, 'P1');
    assert.equal(saved.hotfix.related_feature, '09');
    assert.equal(saved.hotfix.review_required, true);
    assert.equal(saved.events[0].type, 'hotfix.scope_bound');
    assert.throws(() => startHotfix({ cwd: root, featureId: '31' }), /requires INIT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('start-hotfix rejects a non-INIT feature before scope binding', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-hotfix-non-init-'));
  try {
    mkdirSync(join(root, '.cc-nexs'), { recursive: true });
    writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), 'version: 1\n');
    const docs = join(root, 'all-docs', 'doc', '33.already-started');
    mkdirSync(docs, { recursive: true });
    const progress = createProgressV2({ featureId: '33', featureSlug: 'already-started', preset: 'preset-standard', mode: 'hotfix' });
    progress.state = 'HOTFIX_IMPLEMENTING';
    writeProgressV2(join(docs, 'progress.json'), progress);
    assert.throws(() => startHotfix({ cwd: root, featureId: '33' }), /requires INIT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('P3 boundary violations become a deterministic human-intervention state', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-hotfix-p3-'));
  const api = join(root, 'api');
  const docs = join(root, 'all-docs', 'doc', '32.p3-boundary');
  try {
    mkdirSync(join(root, '.cc-nexs'), { recursive: true });
    mkdirSync(api, { recursive: true });
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), [
      'version: 1',
      'docs_repository: docs',
      'repositories:',
      '  - id: docs',
      '    path: all-docs',
      '    docs: true',
      '  - id: api',
      '    path: api',
      '    base_branch: main',
      '    test_branch: test',
    ].join('\n'));

    git(api, ['init', '-b', 'main']);
    git(api, ['config', 'user.name', 'Test User']);
    git(api, ['config', 'user.email', 'test@example.com']);
    writeFileSync(join(api, 'a.txt'), 'base\n');
    git(api, ['add', 'a.txt']);
    git(api, ['commit', '-m', 'base']);
    const base = git(api, ['rev-parse', 'HEAD']);
    writeFileSync(join(api, 'a.txt'), 'changed\n');
    git(api, ['add', 'a.txt']);
    git(api, ['commit', '-m', 'candidate']);
    let candidate = git(api, ['rev-parse', 'HEAD']);
    const candidateRef = 'refs/cc-nexs/candidates/32-p3-boundary/api';
    git(api, ['update-ref', candidateRef, candidate]);

    const progressFile = join(docs, 'progress.json');
    writeProgressV2(progressFile, createProgressV2({ featureId: '32', featureSlug: 'p3-boundary', preset: 'preset-standard', mode: 'hotfix' }));
    writeFileSync(join(docs, 'progress.md'), '# progress\n');
    writeFileSync(join(docs, 'hotfix.md'), [
      '<!-- HOTFIX-SCOPE START -->',
      '- severity: P3',
      '- related_feature: -',
      '- intended_paths: a.txt',
      '- acceptance_contract_change: no',
      '- api_contract_change: no',
      '- database_schema_change: no',
      '- permission_model_change: no',
      '- broad_refactor: no',
      '- non_behavioral_change: yes',
      '<!-- HOTFIX-SCOPE END -->',
    ].join('\n'));
    startHotfix({ cwd: root, featureId: '32', severity: 'P3' });

    const progress = readProgressV2(progressFile);
    progress.state = 'HOTFIX_LOCAL_VERIFYING';
    progress.repositories.api = {
      branch: 'feature/32-p3-boundary',
      worktree: 'api',
      base_branch: 'main',
      base_commit: base,
      candidate: { commit: candidate, ref: candidateRef, paths: ['a.txt'] },
    };
    const fingerprint = candidateFingerprint({ api: candidate });
    progress.local_verification = {
      status: 'passed', context: 'implementation', candidate_fingerprint: fingerprint,
      attempts: [{ id: 'local-verify-1', status: 'passed', context: 'implementation', fingerprint, source: { api: candidate }, evidence: ['smoke'] }],
    };
    writeProgressV2(progressFile, progress);

    const passed = assertHotfixCandidate({ cwd: root, featureId: '32' });
    assert.equal(passed.status, 'passed');
    let saved = readProgressV2(progressFile);
    assert.equal(saved.local_verification.attempts[0].evidence.at(-1).type, 'p3_boundary');
    assert.equal(saved.events.at(-1).type, 'hotfix.p3_boundary_passed');

    writeFileSync(join(api, 'b.txt'), 'second file\n');
    git(api, ['add', 'b.txt']);
    git(api, ['commit', '-m', 'break p3 boundary']);
    candidate = git(api, ['rev-parse', 'HEAD']);
    git(api, ['update-ref', candidateRef, candidate]);
    saved.repositories.api.candidate = { commit: candidate, ref: candidateRef, paths: ['a.txt', 'b.txt'] };
    const expandedFingerprint = candidateFingerprint({ api: candidate });
    saved.local_verification = {
      status: 'passed', context: 'implementation', candidate_fingerprint: expandedFingerprint,
      attempts: [{
        id: 'local-verify-2', status: 'passed', context: 'implementation', fingerprint: expandedFingerprint,
        source: { api: candidate }, evidence: ['smoke'],
      }],
    };
    writeProgressV2(progressFile, saved);

    const result = assertHotfixCandidate({ cwd: root, featureId: '32' });
    assert.equal(result.status, 'blocked');
    assert.match(result.reason, /exactly one changed file/);
    saved = readProgressV2(progressFile);
    assert.equal(saved.state, 'HOTFIX_P3_BOUNDARY_BLOCKED');
    assert.equal(saved.events.at(-1).type, 'hotfix.p3_boundary_blocked');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
