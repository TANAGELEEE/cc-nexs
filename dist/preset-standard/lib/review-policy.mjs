// Whether a Lean candidate needs a code Review before Gateway B.
//
// Verification in the test environment is the main gate. A code Review runs, after
// verification, only where it finds what black-box checks cannot: a high/critical
// plan, or a candidate touching sensitive paths (auth, permission, migration, schema,
// payment/billing, deployment, CI, plus the workspace's own `review.required_paths`).
// `review.policy: always` restores a Review for every task. Hotfix keeps its Review.

import { matchAny } from './build-selector.mjs';
import { isSensitivePlanPath } from './plan-contract.mjs';

export const REVIEW_POLICIES = new Set(['risk', 'always']);

export function reviewRequirement(progress, review = {}) {
  if (progress?.mode !== 'lean') return { required: true, reasons: [`${progress?.mode || 'unknown'} mode always reviews`] };
  const policy = review.policy ?? 'risk';
  if (!REVIEW_POLICIES.has(policy)) throw new Error(`[cc-nexs] review.policy must be risk or always, got ${policy}`);
  if (policy === 'always') return { required: true, reasons: ['review.policy is always'] };
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
