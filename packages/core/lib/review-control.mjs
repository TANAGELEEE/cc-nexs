import { dirname } from 'node:path';

import { resolveCandidateContext } from './candidate-context.mjs';
import { assertHotfixScopeCurrent } from './hotfix-contract.mjs';
import { approvedPlanDeliveryLane, assertPlanApprovalCurrent } from './plan-contract.mjs';
import { candidateFingerprint, recordConsolidatedReview } from './progress-v2.mjs';

export function recordLeanReview({
  cwd = process.cwd(),
  featureId,
  progressPath = null,
  status,
  closure = false,
  gatewayBDelta = false,
  blockingFindings = [],
} = {}) {
  const context = resolveCandidateContext({ cwd, featureId, progressPath });
  if (!['lean', 'hotfix'].includes(context.progress.mode)) throw new Error(`[cc-nexs] review control requires lean or hotfix mode, found ${context.progress.mode}`);
  let leanDeliveryLane = 'standard';
  if (context.progress.mode === 'lean') {
    assertPlanApprovalCurrent(context.progress, dirname(context.progressFile));
    leanDeliveryLane = approvedPlanDeliveryLane(context.progress, dirname(context.progressFile));
    if (!closure && !gatewayBDelta && leanDeliveryLane === 'fast-track') {
      const attempt = context.progress.delivery?.test?.attempts?.at(-1);
      if (attempt?.status !== 'verified' || attempt.fingerprint !== candidateFingerprint(context.source)) {
        throw new Error('[cc-nexs] fast-track consolidated Review requires test verification for the exact candidate');
      }
    }
  }
  else {
    assertHotfixScopeCurrent(context.progress, dirname(context.progressFile));
    if (context.progress.hotfix?.severity === 'P3') throw new Error('[cc-nexs] P3 skips model Review after deterministic boundary proof');
    if ((closure || gatewayBDelta) && (context.progress.review?.closure_attempts || 0) >= 1) {
      throw new Error('[cc-nexs] hotfix permits at most one delta Review; human intervention is required');
    }
  }
  if (closure && gatewayBDelta) throw new Error('[cc-nexs] review cannot be both closure and Gateway B delta');
  const expectedStates = context.progress.mode === 'hotfix'
    ? (closure || gatewayBDelta ? ['HOTFIX_LOCAL_REVERIFYING', 'HOTFIX_DELTA_REVIEW'] : ['HOTFIX_LOCAL_VERIFYING', 'HOTFIX_REVIEWING'])
    : gatewayBDelta
      ? ['GATEWAY_B_LOCAL_REVERIFYING', 'GATEWAY_B_DELTA_REVIEW']
      : closure
        ? ['LOCAL_REVERIFYING', 'REVIEW_CLOSURE']
        : ['LOCAL_VERIFYING', 'CONSOLIDATED_REVIEW', ...(leanDeliveryLane === 'fast-track' ? ['TEST_VERIFIED'] : [])];
  if (!expectedStates.includes(context.progress.state)) {
    throw new Error(`[cc-nexs] ${closure ? 'review closure' : 'consolidated review'} requires ${expectedStates.join(' or ')}, found ${context.progress.state}`);
  }
  return recordConsolidatedReview(context.progressFile, {
    source: context.source,
    status,
    blockingFindings,
    closure: context.progress.mode === 'hotfix' ? (closure || gatewayBDelta) : closure,
    gatewayBDelta: context.progress.mode === 'hotfix' ? false : gatewayBDelta,
    expectedRevision: context.progress.revision,
  });
}
