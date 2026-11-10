// Whether a Lean or Hotfix candidate needs a code Review.
//
// Verification in the test environment is the main gate. A code Review runs, before
// test, only where it finds what black-box checks cannot: a high/critical
// plan, or a candidate touching sensitive paths (auth, permission, migration, schema,
// payment/billing, deployment, CI, plus the workspace's own `review.required_paths`).
// `review.policy: always` restores a Review for every task. A Hotfix is reviewed when it
// is P0/P1 (or has no bound severity); P2/P3 are gated by test verification.

import { matchAny } from './build-selector.mjs';
import { isSensitivePlanPath } from './plan-contract.mjs';
import { REVIEW_STATES } from './state-machine.mjs';

export const REVIEW_POLICIES = new Set(['risk', 'always']);

export function reviewRequirement(progress, review = {}) {
  if (!['lean', 'hotfix'].includes(progress?.mode)) return { required: true, reasons: [`${progress?.mode || 'unknown'} mode always reviews`] };
  const policy = review.policy ?? 'risk';
  if (!REVIEW_POLICIES.has(policy)) throw new Error(`[cc-nexs] review.policy must be risk or always, got ${policy}`);
  if (policy === 'always') return { required: true, reasons: ['review.policy is always'] };
  if (progress.mode === 'hotfix') {
    const severity = progress.hotfix?.severity || null;
    if (!severity) return { required: true, reasons: ['the Hotfix binds no severity'] };
    return ['P0', 'P1'].includes(severity)
      ? { required: true, reasons: [`severity is ${severity}`] }
      : { required: false, reasons: [`severity is ${severity}`] };
  }
  const risk = progress.gates?.plan?.binding?.risk_tier || null;
  if (!risk) return { required: true, reasons: ['the approved plan binds no risk_tier'] };
  if (['high', 'critical'].includes(risk)) return { required: true, reasons: [`risk_tier is ${risk}`] };
  const globs = review.required_paths || [];
  const touched = Object.entries(progress.repositories || {}).flatMap(([repository, assignment]) => (assignment?.candidate?.paths || [])
    .filter((path) => isSensitivePlanPath(path) || (globs.length > 0 && matchAny(path, globs)))
    .map((path) => `${repository}:${path}`));
  if (touched.length) return { required: true, reasons: [`touches sensitive paths ${touched.slice(0, 5).join(', ')}${touched.length > 5 ? ', ...' : ''}`] };
  return { required: false, reasons: [`risk_tier is ${risk} and no sensitive path changed`] };
}

// A Review is satisfied when none is required, or one passed for exactly this candidate.
export function reviewSatisfied(progress, fingerprint, requirement) {
  if (!requirement.required) return true;
  return progress.review?.status === 'passed' && progress.review.candidate_fingerprint === fingerprint;
}

// The Review commands and `advance` refuse a Review nobody asked for: an unrequired one
// costs a reviewer panel and a Judge and, when it blocks, a repair round that test
// verification was meant to decide. A task already in a Review state may finish it.
export function assertReviewRequired(progress, review = {}) {
  const need = reviewRequirement(progress, review);
  if (!need.required && !REVIEW_STATES.has(progress.state)) {
    throw new Error(`[cc-nexs] no Review is required for this candidate (${need.reasons.join('; ')}); continue to test (cc-nexs status shows the next step). review.policy: always reviews every task`);
  }
  return need;
}
