import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { resolveCandidateContext } from './candidate-context.mjs';
import { assertHotfixCandidatePaths, extractHotfixScope, hotfixScopeBinding, resolveHotfixDocument } from './hotfix-contract.mjs';
import { extractLocalVerificationChecks } from './local-evidence.mjs';
import {
  appendProgressEvent,
  candidateFingerprint,
  readProgressV2,
  writeProgressV2,
} from './progress-v2.mjs';

export function startHotfix({ cwd = process.cwd(), featureId, progressPath = null, severity = null, relatedFeature = null, actor = 'orchestrator' } = {}) {
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const progress = readProgressV2(progressFile);
  if (progress.mode !== 'hotfix') throw new Error(`[cc-nexs] start-hotfix requires an independently initialized hotfix, found mode ${progress.mode}`);
  if (progress.state !== 'INIT') throw new Error(`[cc-nexs] start-hotfix requires INIT, found ${progress.state}`);
  const binding = hotfixScopeBinding(dirname(progressFile), progress);
  if (progress.hotfix_document && !extractLocalVerificationChecks(extractHotfixScope(readFileSync(resolveHotfixDocument(progress, dirname(progressFile)), 'utf8')).raw).length) {
    throw new Error('[cc-nexs] fill the BUG local verification matrix before binding');
  }
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
    review_required: true,
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
  if (context.progress.mode !== 'hotfix' || !context.progress.hotfix?.scope_binding) {
    throw new Error('[cc-nexs] assert-hotfix-candidate is only valid for a bound Hotfix');
  }
  const allowedStates = new Set(['HOTFIX_LOCAL_VERIFYING', 'HOTFIX_LOCAL_REVERIFYING']);
  if (!allowedStates.has(context.progress.state)) {
    throw new Error(`[cc-nexs] Hotfix candidate assertion requires HOTFIX_LOCAL_VERIFYING or HOTFIX_LOCAL_REVERIFYING, found ${context.progress.state}`);
  }
  const fingerprint = candidateFingerprint(context.source);
  if (
    context.progress.local_verification?.status !== 'passed'
    || context.progress.local_verification?.candidate_fingerprint !== fingerprint
  ) {
    throw new Error('[cc-nexs] Hotfix candidate assertion requires passed local verification for the exact candidate');
  }
  try {
    assertHotfixCandidatePaths(context);
    return {
      kind: 'hotfix-candidate-boundary',
      status: 'passed',
      feature: context.progress.feature,
      source: context.source,
      review_required: true,
      progressFile: context.progressFile,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const progress = appendProgressEvent(context.progressFile, {
      type: 'hotfix.scope_paths_blocked',
      actor,
      from: context.progress.state,
      to: 'HUMAN_INTERVENTION',
      reason,
      expectedRevision: context.progress.revision,
      data: {
        severity: context.progress.hotfix.severity,
        recovery: 'revise-hotfix with the user authorization; retain the BUG key and branch',
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
