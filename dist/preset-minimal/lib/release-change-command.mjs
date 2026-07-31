import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { renderLeanPlan } from './plan-render.mjs';
import { readProgressV2, recordReleaseChangeRequest } from './progress-v2.mjs';
import {
  appendHotfixChange,
  appendPlanChange,
  appendRequirementChange,
  assertReleaseChangeDocuments,
  syncHotfixChangeStatuses,
  syncPlanChangeStatuses,
} from './release-change-docs.mjs';

const KINDS = new Set(['evidence', 'implementation', 'scope']);

export function requestReleaseChanges({
  cwd = process.cwd(),
  featureId,
  progressPath = null,
  kind,
  feedback,
  affectedAcs = [],
  paths = [],
  actor = null,
} = {}) {
  if (!KINDS.has(kind)) throw new Error(`[cc-nexs] --type must be evidence, implementation, or scope`);
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const before = readProgressV2(progressFile);
  const featureDir = dirname(progressFile);
  if (before.mode === 'hotfix') {
    if (!existsSync(join(featureDir, 'hotfix.md'))) throw new Error('[cc-nexs] hotfix.md is missing');
  } else {
    assertReleaseChangeDocuments(featureDir, { scope: kind === 'scope' });
  }
  const requestedBy = actor || process.env.USER || process.env.USERNAME || 'human';
  const result = recordReleaseChangeRequest(progressFile, {
    kind,
    feedback,
    affectedAcs,
    paths,
    actor: requestedBy,
    expectedRevision: before.revision,
  });
  let rendered = null;
  if (before.mode === 'hotfix') {
    appendHotfixChange(join(featureDir, 'hotfix.md'), result.request);
    syncHotfixChangeStatuses(join(featureDir, 'hotfix.md'), result.progress.change_requests.items);
  } else {
    appendPlanChange(join(featureDir, 'plan.md'), result.request);
    syncPlanChangeStatuses(join(featureDir, 'plan.md'), result.progress.change_requests.items);
    if (kind === 'scope') appendRequirementChange(join(featureDir, 'requirements.md'), result.request);
    rendered = renderLeanPlan({ cwd, featureId, progressPath: progressFile });
  }
  return {
    kind: 'release-change-request',
    feature: result.progress.feature,
    request: result.request,
    state: result.progress.state,
    progressFile,
    planHtml: rendered?.output || null,
  };
}
