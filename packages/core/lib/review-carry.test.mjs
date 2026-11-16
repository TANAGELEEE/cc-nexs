import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { candidateFingerprint, createProgressV2, readProgressV2, recordRepositoryCandidatePrepared, writeProgressV2 } from './progress-v2.mjs';
import { carryReviewOverRepair } from './review-carry.mjs';
import { reviewRequirement, reviewSatisfied } from './review-policy.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-review-carry-'));
  const repo = join(root, 'api');
  mkdirSync(join(repo, 'src', 'auth'), { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 't'); git('config', 'user.email', 't@example.invalid');
  const commit = (file, text) => { writeFileSync(join(repo, file), text); git('add', '.'); git('commit', '-q', '-m', file); return git('rev-parse', 'HEAD'); };
  const reviewed = commit('src/app.js', 'one\n');
  const file = join(root, 'progress.json');
  const progress = createProgressV2({ featureId: '9', featureSlug: 'carry', preset: 'preset-standard', mode: 'lean', repositories: ['api'] });
  progress.state = 'TEST_FIXING';
  progress.gates.plan = { approved: true, binding: { risk_tier: 'high' } };
  progress.repositories.api = { branch: 'feature/9-carry', worktree: 'api', base_branch: 'main', candidate: { commit: null, ref: 'refs/cc-nexs/candidates/9-carry/api', paths: ['src/app.js'] } };
  progress.review = { status: 'passed', candidate_fingerprint: candidateFingerprint({ api: reviewed }), reviewed_commits: { api: reviewed }, blocking_findings: [], closure_attempts: 0, gateway_b_delta_attempts: 0, reviewed_at: '2026-11-16T00:00:00.000Z' };
  writeProgressV2(file, progress);
  // The repair's candidate commit resets the Review but keeps what the passed one covered.
  const repair = (path, text) => {
    const head = commit(path, text);
    recordRepositoryCandidatePrepared(file, 'api', { candidateRef: 'refs/cc-nexs/candidates/9-carry/api', staged: [path] });
    const current = readProgressV2(file);
    current.local_verification = { status: 'passed', context: 'test', candidate_fingerprint: candidateFingerprint({ api: head }), attempts: [] };
    writeProgressV2(file, current);
    return { progressFile: file, source: { api: head }, repositories: [{ id: 'api', repository: { absolute_path: repo }, sourceCommit: head }] };
  };
  return { root, file, reviewed, repair };
}

test('a test repair that touches no sensitive path is carried by the passed Review', () => {
  const f = fixture();
  try {
    const context = f.repair('src/app.js', 'two\n');
    assert.equal(readProgressV2(f.file).review.status, 'idle');
    assert.equal(reviewRequirement(readProgressV2(f.file)).required, true, 'high risk still needs a Review until the carry is proven');
    assert.equal(carryReviewOverRepair(context, { verificationContext: 'review' }), null, 'only a test or Hotfix repair is carried');
    assert.equal(carryReviewOverRepair(context, { verificationContext: 'test', review: { policy: 'always' } }), null);
    const carried = carryReviewOverRepair(context, { verificationContext: 'test' });
    assert.equal(carried.changed_paths, 1);
    const progress = readProgressV2(f.file);
    assert.equal(progress.review.status, 'passed');
    assert.equal(progress.events.at(-1).type, 'review.carried_over');
    const need = reviewRequirement(progress);
    assert.equal(need.required, false);
    assert.match(need.reasons[0], /repair since then touches no sensitive path/);
    assert.equal(reviewSatisfied(progress, candidateFingerprint(context.source), need), true);
    assert.equal(reviewRequirement(progress, { policy: 'always' }).required, true);

    // A second repair is measured against the reviewed commits, not the previous repair.
    const second = f.repair('src/auth/session.js', 'token\n');
    assert.equal(carryReviewOverRepair(second, { verificationContext: 'test' }), null, 'a sensitive path gets its closure Review');
    assert.equal(reviewRequirement(readProgressV2(f.file)).required, true);
    const third = f.repair('src/app.js', 'three\n');
    assert.equal(carryReviewOverRepair(third, { verificationContext: 'test' }), null, 'the sensitive change is still in the cumulative delta');
    assert.equal(carryReviewOverRepair(third, { verificationContext: 'test', review: { required_paths: ['src/app.js'] } }), null);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
