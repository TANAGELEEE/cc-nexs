// After its Review passed, a candidate is repaired when test verification fails. Each
// repair used to go through a closure Review (a reviewer and a Judge) before it could
// return to test; one task did that more than twenty times. A repair that touches no
// sensitive path is now carried by the Review that already passed: test verification
// rechecks what the repair can affect. A sensitive path in the cumulative change since
// the reviewed commits still gets its closure Review.

import { execFileSync } from 'node:child_process';

import { matchAny } from './build-selector.mjs';
import { isSensitivePlanPath } from './plan-contract.mjs';
import { candidateFingerprint, readProgressV2, recordReviewCarry } from './progress-v2.mjs';

const REPAIR_CONTEXTS = new Set(['test', 'hotfix_fix']);

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// Called once a repair candidate is locally verified. Returns the carry, or null when the
// candidate needs its own Review (or never had one).
export function carryReviewOverRepair(context, { verificationContext, review = {} } = {}) {
  if (!REPAIR_CONTEXTS.has(verificationContext) || (review.policy ?? 'risk') === 'always') return null;
  const progress = readProgressV2(context.progressFile);
  const last = progress.review?.status === 'idle' ? progress.review.last_passed : null;
  if (!last) return null;
  const fingerprint = candidateFingerprint(context.source);
  if (progress.local_verification?.candidate_fingerprint !== fingerprint) return null;
  const globs = review.required_paths || [];
  const changed = [];
  for (const item of context.repositories) {
    const reviewed = last.reviewed_commits?.[item.id];
    if (!reviewed) return null;
    let paths;
    try {
      git(item.repository.absolute_path, ['merge-base', '--is-ancestor', reviewed, item.sourceCommit]);
      paths = git(item.repository.absolute_path, ['diff', '--name-only', '--no-renames', reviewed, item.sourceCommit]).split('\n').filter(Boolean);
    } catch { return null; }
    if (paths.some((path) => isSensitivePlanPath(path) || (globs.length > 0 && matchAny(path, globs)))) return null;
    changed.push(...paths.map((path) => `${item.id}:${path}`));
  }
  if (Object.keys(last.reviewed_commits || {}).length !== context.repositories.length) return null;
  recordReviewCarry(context.progressFile, { fingerprint, changedPaths: changed });
  return { fingerprint, reviewed_fingerprint: last.candidate_fingerprint, changed_paths: changed.length };
}
