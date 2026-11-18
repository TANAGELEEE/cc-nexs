import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { computeReviewCarry, reviewCarried } from './review-carry.mjs';
import { assertReviewRequired, reviewSatisfied } from './review-policy.mjs';

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitFile(repo, path, content, message) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
  git(repo, 'add', path);
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'cc-nexs-carry-'));
  git(repo, 'init', '-q', '-b', 'main');
  const base = commitFile(repo, 'src/base.ts', 'base\n', 'base');
  git(repo, 'update-ref', 'refs/remotes/origin/main', base);
  git(repo, 'checkout', '-q', '-b', 'feature');
  const reviewed = commitFile(repo, 'src/app.ts', 'v1\n', 'candidate');
  return { repo, base, reviewed };
}

const progressFor = (reviewed, { status = 'blocked', blocking = [{ id: 'F-1', summary: 'P1: F-1' }], plan = 'plan-a' } = {}) => ({
  mode: 'lean',
  state: 'LOCAL_REVERIFYING',
  gates: { plan: { binding: { combined_sha256: 'plan-a', risk_tier: 'high' } } },
  review: { status: 'idle' },
  review_baseline: { status, fingerprint: 'reviewed', source: { web: reviewed }, blocking, plan_binding: plan },
});

const repositories = (repo, sourceCommit) => [{ id: 'web', repository: { absolute_path: repo, base_branch: 'main' }, assignment: {}, sourceCommit }];
const passed = (check) => ({ check, result: 'passed', command: 'npm test', exit_code: 0, proof: 'ok' });

test('a repair with passing finding checks and no sensitive change carries the Review', () => {
  const { repo, reviewed } = fixture();
  try {
    const repaired = commitFile(repo, 'src/app.ts', 'v2\n', 'fix F-1');
    const progress = progressFor(reviewed);
    const carry = computeReviewCarry({ progress, repositories: repositories(repo, repaired), fingerprint: 'repaired', evidence: [passed('LV-001'), passed('F-1')] });
    assert.deepEqual(carry.changed_paths, ['web:src/app.ts']);
    assert.deepEqual(carry.sensitive_paths, []);
    assert.deepEqual(carry.unresolved_findings, []);
    progress.review.carry = carry;
    progress.local_verification = { candidate_fingerprint: 'repaired' };
    assert.equal(reviewCarried(progress, 'repaired'), true);
    assert.equal(reviewCarried(progress, 'other'), false);
    assert.equal(reviewSatisfied(progress, 'repaired', { required: true, reasons: [] }), true);
    assert.throws(() => assertReviewRequired(progress), /earlier Review carries to this candidate/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('an unresolved finding or a sensitive change keeps the delta Review', () => {
  const { repo, reviewed } = fixture();
  try {
    const repaired = commitFile(repo, 'src/app.ts', 'v2\n', 'fix');
    const unresolved = computeReviewCarry({ progress: progressFor(reviewed), repositories: repositories(repo, repaired), fingerprint: 'r', evidence: [passed('LV-001')] });
    assert.deepEqual(unresolved.unresolved_findings, ['F-1']);
    const legacy = computeReviewCarry({ progress: progressFor(reviewed, { blocking: [{ id: null, summary: 'P1 text' }] }), repositories: repositories(repo, repaired), fingerprint: 'r', evidence: [passed('P1 text')] });
    assert.deepEqual(legacy.unresolved_findings, ['P1 text'], 'a finding without an id cannot be proven resolved');
    const migrated = commitFile(repo, 'db/migrations/002.sql', 'alter table t add c int;\n', 'migration');
    const sensitive = computeReviewCarry({ progress: progressFor(reviewed, { status: 'passed', blocking: [] }), repositories: repositories(repo, migrated), fingerprint: 'm', evidence: [passed('LV-001')] });
    assert.deepEqual(sensitive.sensitive_paths, ['web:db/migrations/002.sql']);
    const configured = computeReviewCarry({ progress: progressFor(reviewed, { status: 'passed', blocking: [] }), repositories: repositories(repo, repaired), fingerprint: 'r', evidence: [passed('LV-001')], review: { required_paths: ['src/app.ts'] } });
    assert.deepEqual(configured.sensitive_paths, ['web:src/app.ts']);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('changes merged from the base do not count as the repair', () => {
  const { repo, base, reviewed } = fixture();
  try {
    git(repo, 'checkout', '-q', '-b', 'moved-base', base);
    const moved = commitFile(repo, 'deploy/values.yaml', 'replicas: 2\n', 'base change');
    git(repo, 'update-ref', 'refs/remotes/origin/main', moved);
    git(repo, 'checkout', '-q', 'feature');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'merge', '-q', '--no-edit', moved);
    const synced = git(repo, 'rev-parse', 'HEAD');
    const carry = computeReviewCarry({ progress: progressFor(reviewed, { status: 'passed', blocking: [] }), repositories: repositories(repo, synced), fingerprint: 's', evidence: [passed('LV-001')] });
    assert.deepEqual(carry.changed_paths, []);
    assert.deepEqual(carry.sensitive_paths, []);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('no carry without a baseline for the current plan, and a repository the Review never saw needs one', () => {
  const { repo, reviewed } = fixture();
  try {
    const repaired = commitFile(repo, 'src/app.ts', 'v2\n', 'fix');
    assert.equal(computeReviewCarry({ progress: progressFor(reviewed, { plan: 'plan-old' }), repositories: repositories(repo, repaired), fingerprint: 'r' }), null);
    assert.equal(computeReviewCarry({ progress: { ...progressFor(reviewed), review_baseline: null }, repositories: repositories(repo, repaired), fingerprint: 'r' }), null);
    assert.equal(computeReviewCarry({ progress: { ...progressFor(reviewed), mode: 'hotfix' }, repositories: repositories(repo, repaired), fingerprint: 'r' }), null);
    const extra = [...repositories(repo, repaired), { id: 'api', repository: { absolute_path: repo, base_branch: 'main' }, assignment: {}, sourceCommit: repaired }];
    const carry = computeReviewCarry({ progress: progressFor(reviewed, { status: 'passed', blocking: [] }), repositories: extra, fingerprint: 'r' });
    assert.deepEqual(carry.sensitive_paths, ['api:* (not in the reviewed candidate)']);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
