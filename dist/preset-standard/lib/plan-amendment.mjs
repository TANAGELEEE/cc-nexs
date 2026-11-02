import { dirname, join } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { assertPlanApprovalCurrent, requirementAcIds } from './plan-contract.mjs';
import { readProgressV2, recordPlanAmendment, recordPlanAmendmentReview } from './progress-v2.mjs';
import { appendPlanAmendment, syncPlanAmendmentStatus } from './release-change-docs.mjs';

export function requestPlanAmendment({ cwd = process.cwd(), featureId, progressPath = null, acs = [], paths = [], reason, target = 'feature' } = {}) {
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const before = readProgressV2(progressFile);
  const featureDir = dirname(progressFile);
  assertPlanApprovalCurrent(before, featureDir);
  const known = new Set(requirementAcIds(featureDir));
  const unknown = acs.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`[cc-nexs] amendments cover approved ACs only; a new criterion is a scope change: ${unknown.join(', ')}`);
  const { progress, amendment } = recordPlanAmendment(progressFile, { acs, paths, reason, target, expectedRevision: before.revision });
  appendPlanAmendment(join(featureDir, 'plan.md'), amendment);
  return { kind: 'plan-amendment', feature: progress.feature, amendment, state: progress.state, progressFile };
}

export function reviewPlanAmendment({ cwd = process.cwd(), featureId, progressPath = null, amendmentId, status, blockingFindings = [] } = {}) {
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const before = readProgressV2(progressFile);
  const { progress, amendment } = recordPlanAmendmentReview(progressFile, { amendmentId, status, blockingFindings, expectedRevision: before.revision });
  syncPlanAmendmentStatus(join(dirname(progressFile), 'plan.md'), amendment);
  return { kind: 'plan-amendment', feature: progress.feature, amendment, state: progress.state, progressFile };
}
