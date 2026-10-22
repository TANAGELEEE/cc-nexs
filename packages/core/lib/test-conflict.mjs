import { readProgressV2, appendProgressEvent, assertTestAttemptNotInvalidated, candidateFingerprint, recordTestIntegration, writeProgressV2 } from './progress-v2.mjs';
import { resolveTestIntegrationConflict } from './git-custodian.mjs';
import { preflightTestRelease, acquireTestReleaseLock, reclaimTestConflictWorktrees } from './test-release.mjs';
import { resolveFeatureProgress } from './approval-command.mjs';

export function resolveTestConflict({ cwd = process.cwd(), featureId, progressPath = null } = {}) {
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const release = acquireTestReleaseLock(progressFile, { allowStaleRecovery: true });
  try {
    const context = preflightTestRelease({ cwd, featureId, progressPath, hotfix: readProgressV2(progressFile).mode === 'hotfix', retry: true });
    const progress = readProgressV2(progressFile);
    const attempt = progress.delivery.test.attempts.at(-1);
    if (attempt?.status !== 'merge_conflict') throw new Error('[cc-nexs] no test merge conflict is waiting for resolution');
    // Every guard runs before the first push: a stale resolution must never reach the shared test branch.
    assertTestAttemptNotInvalidated(attempt);
    if (attempt.fingerprint !== candidateFingerprint(context.source)) {
      throw new Error('[cc-nexs] test merge conflict belongs to a previous candidate; run release-test to integrate the current candidate');
    }
    const releaseState = testReleaseState(progress.mode);
    for (const [id, integration] of Object.entries(attempt.integrations || {})) {
      if (integration.status !== 'conflicts') continue;
      const repository = context.deployRepositories.find(item => item.id === id);
      if (!repository || repository.sourceCommit !== integration.sourceCommit) {
        throw new Error(`[cc-nexs] test merge conflict for ${id} no longer matches the current candidate`);
      }
      const result = resolveTestIntegrationConflict({ repo: repository.repo, worktree: integration.worktree, targetBranch: integration.targetBranch, sourceCommit: integration.sourceCommit, targetBefore: integration.targetBefore });
      recordTestIntegration(progressFile, { attemptId: attempt.id, repository: id, sourceCommit: integration.sourceCommit, targetBranch: integration.targetBranch, targetBefore: integration.targetBefore, integrationCommit: result.integrationCommit, remoteCommit: result.remoteCommit, status: 'resolved' });
    }
    const updated = readProgressV2(progressFile);
    updated.delivery.test.status = 'running';
    updated.delivery.test.attempts.at(-1).status = 'running';
    updated.delivery.test.attempts.at(-1).reason = '';
    updated.delivery.test.attempts.at(-1).conflict_resolved = true;
    writeProgressV2(progressFile, updated);
    appendProgressEvent(progressFile, { type: 'delivery.test.merge_conflict_resolved', from: updated.state, to: releaseState, reason: 'developer resolved test integration conflict' });
    reclaimTestConflictWorktrees(context);
    return { kind: 'test-conflict-resolved', attempt: readProgressV2(progressFile).delivery.test.attempts.at(-1), progressFile };
  } finally { release(); }
}

function testReleaseState(mode) {
  return mode === 'hotfix' ? 'HOTFIX_TEST_RELEASE' : 'TEST_RELEASE';
}

