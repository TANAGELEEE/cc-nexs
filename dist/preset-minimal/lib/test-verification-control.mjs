import { resolveFeatureProgress } from './approval-command.mjs';
import { readProgressV2, recordTestVerification } from './progress-v2.mjs';

export function recordEnvironmentVerification({ cwd = process.cwd(), featureId, progressPath = null, status, attemptId = null, evidence = [] } = {}) {
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const progress = readProgressV2(progressFile);
  const expectedStates = progress.mode === 'hotfix'
    ? ['HOTFIX_TEST_RELEASE', 'HOTFIX_TEST_VERIFYING']
    : progress.mode === 'lean' ? ['TEST_RELEASE', 'TEST_VERIFYING'] : null;
  if (!expectedStates || !expectedStates.includes(progress.state)) {
    throw new Error(`[cc-nexs] environment verification requires lean/hotfix verifying state, found ${progress.mode}/${progress.state}`);
  }
  const attempt = attemptId
    ? progress.delivery?.test?.attempts?.find((item) => item.id === attemptId)
    : progress.delivery?.test?.attempts?.at(-1);
  if (!attempt) throw new Error('[cc-nexs] no test release attempt is available');
  if (attempt.status !== 'succeeded') throw new Error(`[cc-nexs] test release attempt must be succeeded before verification, found ${attempt.status}`);
  if (!attempt.environment_revision) throw new Error('[cc-nexs] test verification requires an environment_revision');
  if (!Array.isArray(evidence) || evidence.length === 0) throw new Error('[cc-nexs] test verification requires at least one evidence item');
  const result = status === 'passed' ? 'passed' : status === 'blocked' ? 'blocked' : null;
  if (!result) throw new Error('[cc-nexs] verification status must be passed or blocked');
  const after = recordTestVerification(progressFile, { attemptId: attempt.id, result, evidence, actor: progress.mode === 'hotfix' ? 'hotfix-verifier' : 'lean-verifier' });
  return { kind: 'test-verification', feature: after.feature, status: result, attempt: attempt.id, progressFile, progress: after };
}
