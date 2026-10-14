import { assertTestAttemptNotInvalidated, candidateFingerprint } from './progress-v2.mjs';
import { jsonValuesEqual } from './canonical-json.mjs';
import { assertRecordedLocalVerification } from './local-evidence.mjs';

// This authorizes base integration with an acknowledged test-environment gap;
// it neither verifies test nor authorizes a production deployment.
export function createReleaseExceptionBinding(progress, options) {
  for (const field of ['authorizationEvidence', 'reason', 'environmentEvidence', 'rollbackEvidence']) {
    if (typeof options?.[field] !== 'string' || !options[field].trim()) {
      throw new Error(`[cc-nexs] test exception requires ${field}`);
    }
  }
  const { attempt, local } = assertExceptionPrerequisites(progress);
  return {
    kind: 'test_environment_unavailable',
    authorization_evidence: options.authorizationEvidence.trim(),
    reason: options.reason.trim(),
    environment_evidence: options.environmentEvidence.trim(),
    rollback_evidence: options.rollbackEvidence.trim(),
    local_verification_attempt: local.id,
    test_verification: structuredClone(attempt.verification),
  };
}

export function assertReleaseExceptionCurrent(progress, binding) {
  const exception = binding?.test_exception;
  if (exception?.kind !== 'test_environment_unavailable') {
    throw new Error('[cc-nexs] release test exception is missing or invalid');
  }
  const rebuilt = createReleaseExceptionBinding(progress, {
    authorizationEvidence: exception.authorization_evidence,
    reason: exception.reason,
    environmentEvidence: exception.environment_evidence,
    rollbackEvidence: exception.rollback_evidence,
  });
  const attempt = progress.delivery.test.attempts.at(-1);
  if (!jsonValuesEqual(rebuilt, exception)
    || binding.test_attempt !== attempt.id
    || binding.candidate_fingerprint !== attempt.fingerprint
    || !jsonValuesEqual(binding.source, attempt.source)
    || !jsonValuesEqual(binding.environment_revision, attempt.environment_revision)) {
    throw new Error('[cc-nexs] release test exception evidence changed after approval');
  }
}

function assertExceptionPrerequisites(progress) {
  if (!['lean', 'hotfix'].includes(progress.mode)) throw new Error('[cc-nexs] test exception requires Lean or Hotfix');
  const attempt = progress.delivery?.test?.attempts?.at(-1);
  assertTestAttemptNotInvalidated(attempt);
  if (!attempt || attempt.status !== 'deployed_needs_manual_verification'
    || attempt.verification?.result !== 'manual_required'
    || !Array.isArray(attempt.verification.evidence) || attempt.verification.evidence.length === 0) {
    throw new Error('[cc-nexs] test exception requires the latest deployed manual-required test attempt');
  }
  if (progress.events.some((event) => event.type === 'delivery.test.verification_blocked'
    && event.data?.attempt === attempt.id)) {
    throw new Error('[cc-nexs] a product verification failure cannot become an environment exception');
  }
  const fingerprint = candidateFingerprint(attempt.source || {});
  if (Object.keys(attempt.source || {}).length === 0 || attempt.fingerprint !== fingerprint) {
    throw new Error('[cc-nexs] test exception candidate fingerprint is invalid');
  }
  if (!attempt.pipeline || Object.keys(attempt.pipeline).length === 0
    || attempt.deployment?.environment !== (attempt.environment || 'test')
    || !attempt.environment_revision || Object.keys(attempt.integrations || {}).length === 0
    || Object.entries(attempt.integrations).some(([repository, integration]) => (
      !integration.integrationCommit
      || integration.sourceCommit !== attempt.source[repository]
      || attempt.environment_revision[repository] !== integration.integrationCommit
    ))) {
    throw new Error('[cc-nexs] test exception requires deployment evidence for the exact integrated test revision');
  }
  if (progress.local_verification?.status !== 'passed') {
    throw new Error('[cc-nexs] test exception requires passed local verification for the same candidate');
  }
  const local = assertRecordedLocalVerification(progress, { source: attempt.source, fingerprint });
  if (progress.review?.status !== 'passed' || progress.review.candidate_fingerprint !== fingerprint) {
    throw new Error('[cc-nexs] test exception requires a passing consolidated Review for the same candidate');
  }
  return { attempt, local };
}
