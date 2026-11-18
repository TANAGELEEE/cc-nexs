// A Lean Review covers later repairs of the same candidate without another Review round.
//
// Every Review records a baseline (`progress.review_baseline`, written by recordReview):
// the reviewed commits, its outcome, and the ids of the findings that blocked it. When a repaired candidate passes local verification, the
// controller checks it against that baseline. The Review carries to the new candidate when
//   - every blocking finding has a passed local check named by its id (the reproduction
//     the Judge confirmed now passes), and
//   - the repair changed no sensitive path (built-in infrastructure paths, or the
//     workspace's `review.required_paths`) of the candidate's own changes.
// Otherwise the state machine asks for one delta Review as before. Test verification
// remains the gate for everything else the repair changed. A new Gateway A approval
// starts over: the baseline is bound to the plan it reviewed.

import { execFileSync } from 'node:child_process';

import { matchAny } from './build-selector.mjs';
import { isSensitivePlanPath } from './plan-contract.mjs';

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function lines(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

// Paths the candidate itself changed since the reviewed commits: changes between the two
// commits that are also part of the candidate's diff against its base, so a merged base
// does not count as a repair.
function changedSinceReview(item, reviewedCommit) {
  const repo = item.repository.absolute_path;
  const base = item.assignment.base_branch || item.repository.base_branch;
  const sinceReview = new Set(lines(git(repo, ['diff', '--name-only', reviewedCommit, item.sourceCommit])));
  let own;
  try {
    const mergeBase = git(repo, ['merge-base', item.sourceCommit, `refs/remotes/origin/${base}`]);
    own = new Set(lines(git(repo, ['diff', '--name-only', mergeBase, item.sourceCommit])));
  } catch {
    own = sinceReview;
  }
  return [...sinceReview].filter((path) => own.has(path)).sort();
}

// Computes the carry for the candidate that just passed local verification, or null when
// there is no Review baseline to carry.
export function computeReviewCarry({ progress, repositories, fingerprint, evidence = [], review = {} }) {
  const baseline = progress.review_baseline;
  if (progress.mode !== 'lean' || !baseline || baseline.fingerprint === fingerprint) return null;
  if (!['passed', 'blocked'].includes(baseline.status)) return null;
  const currentPlan = progress.gates?.plan?.binding?.combined_sha256 || null;
  if (!baseline.plan_binding || baseline.plan_binding !== currentPlan) return null;
  const passedChecks = new Set(evidence.filter((item) => item?.result === 'passed').map((item) => String(item.check).trim()));
  const unresolved = baseline.status === 'blocked'
    ? baseline.blocking.filter((item) => !item.id || !passedChecks.has(item.id)).map((item) => item.id || item.summary)
    : [];
  const globs = review.required_paths || [];
  const changed = [];
  const sensitive = [];
  for (const item of repositories) {
    const reviewed = baseline.source[item.id];
    let paths;
    if (!reviewed) {
      paths = null;
    } else {
      try { paths = changedSinceReview(item, reviewed); } catch { paths = null; }
    }
    if (paths === null) {
      // A repository the Review never saw, or a diff Git cannot produce, needs a Review.
      changed.push(`${item.id}:*`);
      sensitive.push(`${item.id}:* (not in the reviewed candidate)`);
      continue;
    }
    for (const path of paths) {
      changed.push(`${item.id}:${path}`);
      if (isSensitivePlanPath(path) || (globs.length > 0 && matchAny(path, globs))) sensitive.push(`${item.id}:${path}`);
    }
  }
  return {
    from_fingerprint: baseline.fingerprint,
    from_source: { ...baseline.source },
    to_fingerprint: fingerprint,
    changed_paths: changed,
    sensitive_paths: sensitive,
    unresolved_findings: unresolved,
    computed_at: new Date().toISOString(),
  };
}

// True when the recorded carry applies to this exact candidate and needs no Review.
export function reviewCarried(progress, fingerprint) {
  const carry = progress?.review?.carry;
  return progress?.mode === 'lean' && Boolean(fingerprint) && carry?.to_fingerprint === fingerprint
    && carry.sensitive_paths.length === 0 && carry.unresolved_findings.length === 0;
}
