import { resolveFeatureProgress } from './approval-command.mjs';
import { readProgressV2, recordTestVerification } from './progress-v2.mjs';
import { preflightTestRelease } from './test-release.mjs';

export function recordEnvironmentVerification({ cwd = process.cwd(), featureId, progressPath = null, status, attemptId = null, evidence = [] } = {}) {
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const before = readProgressV2(progressFile);
  const context = preflightTestRelease({
    cwd,
    featureId,
    progressPath,
    hotfix: before.mode === 'hotfix',
    verification: true,
  });
  const progress = context.progress;
  const expectedStates = progress.mode === 'hotfix'
    ? ['HOTFIX_TEST_RELEASE', 'HOTFIX_TEST_VERIFYING', 'HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY']
    : progress.mode === 'lean'
      ? ['TEST_RELEASE', 'TEST_VERIFYING', 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY']
      : progress.mode === 'full'
        ? ['TEST_RELEASE', 'FINAL_QA', 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY']
        : ['TEST_RELEASE', 'TEST', 'REGRESSION', 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY'];
  if (!expectedStates || !expectedStates.includes(progress.state)) {
    throw new Error(`[cc-nexs] environment verification requires an active test-verifying state, found ${progress.mode}/${progress.state}`);
  }
  const latestAttempt = progress.delivery?.test?.attempts?.at(-1);
  const attempt = attemptId
    ? progress.delivery?.test?.attempts?.find((item) => item.id === attemptId)
    : latestAttempt;
  if (!attempt) throw new Error('[cc-nexs] no test release attempt is available');
  if (attempt !== latestAttempt) throw new Error('[cc-nexs] only the latest test release attempt may be verified');
  if (JSON.stringify(sortedObject(attempt.source)) !== JSON.stringify(sortedObject(context.source))) {
    throw new Error('[cc-nexs] test verification candidate no longer matches the current immutable refs');
  }
  const allowedAttemptStatuses = status === 'manual_required'
    ? ['succeeded']
    : ['succeeded', 'deployed_needs_manual_verification'];
  if (!allowedAttemptStatuses.includes(attempt.status)) {
    throw new Error(`[cc-nexs] test release attempt must be deployed before verification, found ${attempt.status}`);
  }
  if (!attempt.environment_revision) throw new Error('[cc-nexs] test verification requires an environment_revision');
  if (!Array.isArray(evidence) || evidence.length === 0) throw new Error('[cc-nexs] test verification requires at least one evidence item');
  const result = ['passed', 'blocked', 'manual_required'].includes(status) ? status : null;
  if (!result) throw new Error('[cc-nexs] verification status must be passed, blocked, or manual_required');
  const actor = progress.mode === 'hotfix' ? 'hotfix-verifier' : progress.mode === 'lean' ? 'lean-verifier' : 'verifier';
  const after = recordTestVerification(progressFile, { attemptId: attempt.id, result, evidence, actor });
  return { kind: 'test-verification', feature: after.feature, status: result, attempt: attempt.id, progressFile, progress: after };
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right)));
}
