import { resolveFeatureProgress } from './approval-command.mjs';
import { appendProgressEvent, readProgressV2, recordTestVerification } from './progress-v2.mjs';
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
    : ['TEST_RELEASE', 'TEST_VERIFYING', 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY'];
  if (!expectedStates.includes(progress.state)) {
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
  assertVerificationBlocker(result, evidence);
  const actor = progress.mode === 'hotfix' ? 'hotfix-verifier' : progress.mode === 'lean' ? 'lean-verifier' : 'verifier';
  let after = recordTestVerification(progressFile, { attemptId: attempt.id, result, evidence, actor });
  // Persist the next actionable state before returning, including on a forked run.
  const target = verificationResultState(progress.mode, result);
  if (target && after.state !== target) after = appendProgressEvent(progressFile, {
    type: 'delivery.test.verification_reconciled', from: after.state, to: target,
    actor, data: { attempt: attempt.id, result },
  });
  return { kind: 'test-verification', feature: after.feature, status: result, attempt: attempt.id, progressFile, progress: after };
}

export function assertVerificationBlocker(result, evidence) {
  if (result !== 'manual_required') return;
  const blocker = evidence.find(item => item?.type === 'human_input_required');
  if (!blocker || ['check', 'reason', 'attempted', 'required_input', 'resume_action']
    .some(field => typeof blocker[field] !== 'string' || !blocker[field].trim())) {
    throw new Error('[cc-nexs] manual_required needs human_input_required evidence with check, reason, attempted, required_input and resume_action; unfinished automated verification must continue');
  }
  if (blocker.cause === 'pre_existing_defect') {
    if (['baseline_commit', 'baseline_proof', 'candidate_proof', 'impact', 'alternative_attempted', 'tracking', 'review_proof']
      .some(field => typeof blocker[field] !== 'string' || !blocker[field].trim())
      || !/^[a-f0-9]{40,64}$/i.test(blocker.baseline_commit)) {
      throw new Error('[cc-nexs] pre_existing_defect requires baseline commit/reproduction, candidate reproduction, impact, alternative attempt, tracking and independent review proof');
    }
  }
}

export function verificationResultState(mode, result) {
  if (result === 'manual_required') return mode === 'hotfix' ? 'HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY' : 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY';
  if (mode === 'lean') return result === 'passed' ? 'TEST_VERIFIED' : 'TEST_VERIFY_FAILED';
  if (mode === 'hotfix') return result === 'passed' ? 'HOTFIX_TEST_VERIFIED' : 'HOTFIX_TEST_FAILED';
  return null;
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right)));
}
