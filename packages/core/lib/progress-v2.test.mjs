import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  appendProgressEvent,
  beginTestRelease,
  completeTestRelease,
  createProgressV2,
  readProgressV2,
  recordRepositoryCandidate,
  recordRepositoryAssignments,
  recordTestIntegration,
  recordTestVerification,
  writeProgressV2,
} from './progress-v2.mjs';

test('progress v2 appends idempotent events and rejects stale writers', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-progress-'));
  const file = join(root, 'progress.json');
  try {
    writeProgressV2(file, createProgressV2({ featureId: '01', featureSlug: 'demo', preset: 'preset-standard' }));
    appendProgressEvent(file, { type: 'state.transition', from: 'INIT', to: 'REQ_DRAFTED', expectedRevision: 0, eventId: 'event-1' });
    appendProgressEvent(file, { type: 'state.transition', from: 'INIT', to: 'REQ_DRAFTED', eventId: 'event-1' });
    const progress = readProgressV2(file);
    assert.equal(progress.state, 'REQ_DRAFTED');
    assert.equal(progress.revision, 1);
    assert.equal(progress.events.length, 1);
    assert.throws(() => appendProgressEvent(file, { type: 'state.transition', from: 'REQ_DRAFTED', to: 'SPEC_DRAFTED', expectedRevision: 0 }), /stale progress revision/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('repository assignments persist only workspace-relative paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-progress-path-'));
  const file = join(root, 'progress.json');
  try {
    writeProgressV2(file, createProgressV2({ featureId: '02', featureSlug: 'paths', preset: 'preset-standard' }));
    recordRepositoryAssignments(file, [{ repository: 'api', branch: 'feature/02-paths', worktree: join(root, '.worktrees/02-paths/api'), baseBranch: 'master', baseCommit: 'abc123' }], { workspaceRoot: root });
    const progress = readProgressV2(file);
    assert.equal(progress.repositories.api.worktree, '.worktrees/02-paths/api');
    assert.equal(progress.repositories.api.base_branch, 'master');
    assert.equal(progress.repositories.api.base_commit, 'abc123');
    assert.equal(JSON.stringify(progress).includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('new progress defaults to final-only automatic test delivery', () => {
  const progress = createProgressV2({ featureId: '03', featureSlug: 'delivery', preset: 'preset-standard', mode: 'full' });
  assert.equal(progress.delivery.strategy, 'final_only');
  assert.equal(progress.delivery.test.policy, 'auto_if_ready');
  assert.deepEqual(progress.delivery.test.attempts, []);
});

test('test release attempts are idempotent and retain integration plus verification evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-progress-release-'));
  const file = join(root, 'progress.json');
  try {
    writeProgressV2(file, createProgressV2({ featureId: '04', featureSlug: 'release', preset: 'preset-standard' }));
    const first = beginTestRelease(file, { source: { api: 'abc123', web: 'def456' } });
    const duplicate = beginTestRelease(file, { source: { web: 'def456', api: 'abc123' } });
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.attempt.id, first.attempt.id);

    recordTestIntegration(file, {
      attemptId: first.attempt.id,
      repository: 'api',
      sourceCommit: 'abc123',
      targetBranch: 'test',
      targetBefore: 'base123',
      integrationCommit: 'merge123',
    });
    completeTestRelease(file, {
      attemptId: first.attempt.id,
      status: 'succeeded',
      pipeline: { id: '42', url: 'https://ci.example/pipelines/42' },
      deployment: { environment: 'test' },
      environmentRevision: { api: 'merge123' },
    });
    recordTestVerification(file, { attemptId: first.attempt.id, result: 'passed', evidence: ['test-report.md'] });

    const progress = readProgressV2(file);
    const attempt = progress.delivery.test.attempts[0];
    assert.equal(attempt.integrations.api.integrationCommit, 'merge123');
    assert.equal(attempt.pipeline.id, '42');
    assert.equal(attempt.verification.result, 'passed');
    assert.equal(attempt.status, 'verified');
    assert.equal(progress.delivery.test.status, 'verified');
    assert.equal(progress.events.length, 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retry creates a new attempt instead of resuming a running release implicitly', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-progress-release-retry-'));
  const file = join(root, 'progress.json');
  try {
    const progress = createProgressV2({ featureId: '05', featureSlug: 'retry', preset: 'preset-standard' });
    progress.repositories.api = { branch: 'feature/05-retry', worktree: '.worktrees/05-retry/api', candidate: null };
    writeProgressV2(file, progress);
    const first = beginTestRelease(file, { source: { api: 'abc123' } });
    const duplicate = beginTestRelease(file, { source: { api: 'abc123' } });
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.attempt.status, 'running');
    assert.throws(() => recordRepositoryCandidate(file, 'api', {
      commit: 'def456', candidateRef: 'refs/cc-nexs/candidates/05-retry/api', staged: ['src/api.js'],
    }), /cannot update a repository candidate while test release is running/);

    const retried = beginTestRelease(file, { source: { api: 'abc123' }, retry: true });
    assert.equal(retried.reused, false);
    assert.notEqual(retried.attempt.id, first.attempt.id);
    assert.equal(readProgressV2(file).delivery.test.attempts.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deployed failures and rejected acceptance invalidate stale release and G2 state', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-progress-release-invalidate-'));
  const file = join(root, 'progress.json');
  try {
    const progress = createProgressV2({ featureId: '06', featureSlug: 'invalidate', preset: 'preset-standard' });
    progress.state = 'ACCEPTANCE';
    progress.gates.g2 = { approved: true, approver: 'release-owner', sprints: {} };
    writeProgressV2(file, progress);
    const started = beginTestRelease(file, { source: { api: 'abc123' } });
    completeTestRelease(file, {
      attemptId: started.attempt.id,
      status: 'succeeded',
      pipeline: { id: 'p1' },
      deployment: { id: 'd1' },
      environmentRevision: { api: 'merge123' },
    });
    recordTestVerification(file, { attemptId: started.attempt.id, result: 'passed' });
    appendProgressEvent(file, {
      type: 'state.transition',
      from: 'ACCEPTANCE',
      to: 'ACCEPTANCE_REJECTED',
    });

    const saved = readProgressV2(file);
    assert.equal(saved.delivery.test.status, 'idle');
    assert.equal(saved.gates.g2.approved, false);
    assert.equal(saved.delivery.test.attempts[0].status, 'verified');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
