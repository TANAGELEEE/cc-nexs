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
  candidateFingerprint,
  readProgressV2,
  recordConsolidatedReview,
  recordLocalVerification,
  recordRepositoryCandidate,
  recordRepositoryAssignments,
  recordTestIntegration,
  recordTestVerification,
  recordReleaseChangeRequest,
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

test('Gateway B implementation feedback invalidates current evidence and returns to a bounded delta loop', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-gateway-b-change-'));
  const file = join(root, 'progress.json');
  try {
    const progress = createProgressV2({ featureId: '03d', featureSlug: 'gateway-change', preset: 'preset-standard' });
    progress.state = 'RELEASE_PENDING_HUMAN';
    progress.local_verification = { status: 'passed', candidate_fingerprint: 'candidate', attempts: [{ fingerprint: 'candidate', status: 'passed' }] };
    progress.review = { status: 'passed', candidate_fingerprint: 'candidate', reviewed_commits: { api: 'abc' }, blocking_findings: [], closure_attempts: 0, gateway_b_delta_attempts: 0 };
    progress.delivery.test.status = 'verified';
    progress.gates.release = { approved: false, binding: null };
    writeProgressV2(file, progress);

    const { request } = recordReleaseChangeRequest(file, {
      kind: 'implementation', feedback: '调整错误提示', affectedAcs: ['AC-001'], paths: ['web/src/error.ts'], actor: 'product-owner',
    });
    const saved = readProgressV2(file);
    assert.equal(request.id, 'gateway-b-1');
    assert.equal(saved.state, 'GATEWAY_B_CHANGE_REQUESTED');
    assert.equal(saved.local_verification.status, 'idle');
    assert.equal(saved.review.status, 'idle');
    assert.equal(saved.delivery.test.status, 'idle');
    assert.equal(saved.change_requests.current, 'gateway-b-1');
    assert.equal(saved.delivery.test.attempts.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Gateway B evidence feedback stays at the gate while scope feedback invalidates Gateway A', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-gateway-b-kinds-'));
  const file = join(root, 'progress.json');
  try {
    const progress = createProgressV2({ featureId: '03e', featureSlug: 'gateway-kinds', preset: 'preset-standard' });
    progress.state = 'RELEASE_PENDING_HUMAN';
    progress.gates.plan = { approved: true, binding: { combined_sha256: 'approved' } };
    writeProgressV2(file, progress);
    recordReleaseChangeRequest(file, { kind: 'evidence', feedback: '补充截图', actor: 'owner' });
    let saved = readProgressV2(file);
    assert.equal(saved.state, 'RELEASE_PENDING_HUMAN');
    assert.equal(saved.gates.plan.approved, true);

    recordReleaseChangeRequest(file, { kind: 'scope', feedback: '新增 AC', affectedAcs: ['AC-002'], actor: 'owner' });
    saved = readProgressV2(file);
    assert.equal(saved.state, 'SCOPE_CHANGE_REQUESTED');
    assert.equal(saved.gates.plan.approved, false);
    assert.equal(saved.change_requests.current, 'gateway-b-2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Hotfix Gateway B implementation feedback enters one bounded repair path and scope expansion is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-hotfix-gateway-b-'));
  const file = join(root, 'progress.json');
  try {
    const progress = createProgressV2({ featureId: '03h', featureSlug: 'hotfix-gate', preset: 'preset-standard', mode: 'hotfix' });
    progress.state = 'HOTFIX_RELEASE_PENDING_HUMAN';
    progress.hotfix = {
      severity: 'P2', related_feature: null, review_required: true, scope_bound_at: new Date().toISOString(),
      scope_binding: { hotfix_scope_sha256: 'scope', severity: 'P2', related_feature: null, file: 'hotfix.md' },
    };
    writeProgressV2(file, progress);
    recordReleaseChangeRequest(file, { kind: 'implementation', feedback: '修正边界处理', paths: ['src/a.js'], actor: 'owner' });
    let saved = readProgressV2(file);
    assert.equal(saved.state, 'HOTFIX_CHANGE_REQUESTED');
    saved.state = 'HOTFIX_RELEASE_PENDING_HUMAN';
    writeProgressV2(file, saved);
    assert.throws(() => recordReleaseChangeRequest(file, { kind: 'scope', feedback: '新增接口', actor: 'owner' }), /lean\/full/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Hotfix test verification failures increment the persisted circuit-breaker counter', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-hotfix-test-counter-'));
  const file = join(root, 'progress.json');
  try {
    const progress = createProgressV2({ featureId: '03i', featureSlug: 'hotfix-counter', preset: 'preset-standard', mode: 'hotfix' });
    writeProgressV2(file, progress);
    const started = beginTestRelease(file, { source: { api: 'abc123' } });
    completeTestRelease(file, {
      attemptId: started.attempt.id,
      status: 'succeeded',
      environmentRevision: { api: 'test123' },
    });
    recordTestVerification(file, { attemptId: started.attempt.id, result: 'blocked', evidence: ['BUG still reproduces'] });
    recordTestVerification(file, { attemptId: started.attempt.id, result: 'blocked', evidence: ['duplicate command retry'] });
    const saved = readProgressV2(file);
    assert.equal(saved.counters.fix_per_bug.HOTFIX_TEST, 1);
    assert.equal(saved.events.at(-1).data.hotfix_test_failures, 1);
    assert.equal(saved.events.at(-1).data.duplicate_attempt_result, true);
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

test('new progress uses lean as the default mode', () => {
  const progress = createProgressV2({ featureId: '03a', featureSlug: 'lean-default', preset: 'preset-standard' });
  assert.equal(progress.mode, 'lean');
  assert.equal(progress.gates.plan.approved, false);
  assert.equal(progress.gates.release.approved, false);
});

test('Lean evidence is candidate-bound and candidate changes invalidate stale approvals', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-progress-lean-'));
  const file = join(root, 'progress.json');
  try {
    const progress = createProgressV2({ featureId: '03b', featureSlug: 'lean-evidence', preset: 'preset-standard' });
    progress.repositories.api = { branch: 'feature/03b-lean-evidence', worktree: '.worktrees/03b-lean-evidence/api', candidate: null };
    progress.gates.release = { approved: true, binding: { candidate_fingerprint: 'old' } };
    writeProgressV2(file, progress);
    const source = { api: 'abc123' };
    recordLocalVerification(file, { source, status: 'passed', evidence: ['build', 'smoke'] });
    recordConsolidatedReview(file, { source, status: 'passed' });
    let saved = readProgressV2(file);
    assert.equal(saved.local_verification.candidate_fingerprint, candidateFingerprint(source));
    assert.equal(saved.review.candidate_fingerprint, candidateFingerprint(source));

    recordRepositoryCandidate(file, 'api', {
      commit: 'def456', candidateRef: 'refs/cc-nexs/candidates/03b-lean-evidence/api', staged: ['src/api.js'],
    });
    saved = readProgressV2(file);
    assert.equal(saved.local_verification.status, 'idle');
    assert.equal(saved.review.status, 'idle');
    assert.equal(saved.gates.release.approved, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('consolidated Review rejects a candidate not covered by local verification', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-progress-review-bind-'));
  const file = join(root, 'progress.json');
  try {
    writeProgressV2(file, createProgressV2({ featureId: '03c', featureSlug: 'review-bind', preset: 'preset-standard' }));
    recordLocalVerification(file, { source: { api: 'abc123' }, status: 'passed' });
    assert.throws(
      () => recordConsolidatedReview(file, { source: { api: 'def456' }, status: 'passed' }),
      /same candidate/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
