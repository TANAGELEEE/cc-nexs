import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { resolveCandidateContext } from './candidate-context.mjs';
import { assertP3CandidateBoundary, hotfixScopeBinding } from './hotfix-contract.mjs';
import {
  appendProgressEvent,
  candidateFingerprint,
  readProgressV2,
  recordHotfixBoundaryEvidence,
  writeProgressV2,
} from './progress-v2.mjs';

export function startHotfix({ cwd = process.cwd(), featureId, progressPath = null, severity = null, relatedFeature = null, actor = 'orchestrator' } = {}) {
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const progress = readProgressV2(progressFile);
  if (progress.mode !== 'hotfix') throw new Error(`[cc-nexs] start-hotfix requires an independently initialized hotfix, found mode ${progress.mode}`);
  if (progress.state !== 'INIT') throw new Error(`[cc-nexs] start-hotfix requires INIT, found ${progress.state}`);
  const binding = hotfixScopeBinding(dirname(progressFile));
  if (severity && String(severity).toUpperCase() !== binding.severity) {
    throw new Error(`[cc-nexs] --level ${severity} does not match hotfix.md severity ${binding.severity}`);
  }
  if (relatedFeature !== null && String(relatedFeature) !== String(binding.related_feature || '')) {
    throw new Error('[cc-nexs] --related does not match hotfix.md related_feature');
  }
  const timestamp = new Date().toISOString();
  progress.hotfix = {
    severity: binding.severity,
    related_feature: binding.related_feature,
    scope_binding: binding,
    scope_bound_at: timestamp,
    review_required: binding.severity !== 'P3',
  };
  progress.state = 'HOTFIX_IMPLEMENTING';
  progress.revision += 1;
  progress.updated_at = timestamp;
  progress.events.push({
    id: randomUUID(), sequence: progress.revision, timestamp,
    type: 'hotfix.scope_bound', actor, from: 'INIT', to: 'HOTFIX_IMPLEMENTING', data: binding,
  });
  writeProgressV2(progressFile, progress);
  return { kind: 'hotfix-start', feature: progress.feature, state: progress.state, hotfix: progress.hotfix, progressFile };
}

export function assertHotfixCandidate({ cwd = process.cwd(), featureId, progressPath = null, actor = 'hotfix-boundary-controller' } = {}) {
  const context = resolveCandidateContext({ cwd, featureId, progressPath });
  if (context.progress.mode !== 'hotfix' || context.progress.hotfix?.severity !== 'P3') {
    throw new Error('[cc-nexs] assert-hotfix-candidate is only valid for a bound P3 hotfix');
  }
  const allowedStates = new Set(['HOTFIX_LOCAL_VERIFYING', 'HOTFIX_LOCAL_REVERIFYING']);
  if (!allowedStates.has(context.progress.state)) {
    throw new Error(`[cc-nexs] P3 candidate assertion requires HOTFIX_LOCAL_VERIFYING or HOTFIX_LOCAL_REVERIFYING, found ${context.progress.state}`);
  }
  const fingerprint = candidateFingerprint(context.source);
  if (
    context.progress.local_verification?.status !== 'passed'
    || context.progress.local_verification?.candidate_fingerprint !== fingerprint
  ) {
    throw new Error('[cc-nexs] P3 candidate assertion requires passed local verification for the exact candidate');
  }
  try {
    const boundary = assertP3CandidateBoundary(context);
    recordHotfixBoundaryEvidence(context.progressFile, {
      source: context.source,
      boundary,
      actor,
      expectedRevision: context.progress.revision,
    });
    return {
      kind: 'hotfix-candidate-boundary',
      status: 'passed',
      feature: context.progress.feature,
      source: context.source,
      boundary,
      progressFile: context.progressFile,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const progress = appendProgressEvent(context.progressFile, {
      type: 'hotfix.p3_boundary_blocked',
      actor,
      from: context.progress.state,
      to: 'HOTFIX_P3_BOUNDARY_BLOCKED',
      reason,
      expectedRevision: context.progress.revision,
      data: {
        severity: 'P3',
        recovery: 'restart as a P0/P1/P2 hotfix or initialize a lean/full change',
      },
    });
    return {
      kind: 'hotfix-candidate-boundary',
      status: 'blocked',
      feature: progress.feature,
      source: context.source,
      reason,
      state: progress.state,
      progressFile: context.progressFile,
    };
  }
}
