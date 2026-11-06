import { releaseScope } from './release-scope.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveCandidateContext } from './candidate-context.mjs';
import { assertHotfixScopeCurrent, extractHotfixScope, resolveHotfixDocument } from './hotfix-contract.mjs';
import { approvedPlanDeliveryLane, assertPlanApprovalCurrent, extractApprovalScope, planApprovalBinding } from './plan-contract.mjs';
import { assertRecordedLocalVerification, extractLocalVerificationChecks } from './local-evidence.mjs';
import { assertTestAttemptNotInvalidated, candidateFingerprint, readProgressV2, recordConsolidatedReview, recordPlanReview } from './progress-v2.mjs';
import { resolveFeatureProgress } from './approval-command.mjs';
import { hasReviewBlock, readReviewFindings } from './finding-contract.mjs';
import { readReviewerResult, resolveReviewPanel } from './review-panel.mjs';
import { detectRuntime } from './runtime-resolver.mjs';

// Every reviewer the Judge lists must have stored its own findings for this round and
// candidate, on the model the block names.
function assertReviewerResults(context, round, reviewers, runtime) {
  const fingerprint = candidateFingerprint(context.source);
  for (const reviewer of reviewers) {
    const result = readReviewerResult({ workspaceRoot: context.workspaceRoot, featureId: context.progress.feature.id, round, reviewerId: reviewer.id });
    if (!result) {
      throw new Error(`[cc-nexs] reviewer ${reviewer.id} has no stored ${round} result; run it with run-reviewer (CLI) or record it with record-reviewer (native)`);
    }
    if (result.fingerprint !== fingerprint) throw new Error(`[cc-nexs] reviewer ${reviewer.id}'s stored result is for another candidate`);
    if (result.runtime && result.runtime !== runtime) throw new Error(`[cc-nexs] reviewer ${reviewer.id}'s stored result came from the ${result.runtime} panel, not ${runtime}`);
    if (result.model !== reviewer.model) throw new Error(`[cc-nexs] reviewer ${reviewer.id} ran on ${result.model}, but the review block says ${reviewer.model}`);
  }
}

export function recordLeanReview({
  cwd = process.cwd(),
  featureId,
  progressPath = null,
  status,
  closure = false,
  gatewayBDelta = false,
  blockingFindings = [],
  documentFindings = false,
  notReproduced = [],
} = {}) {
  if (documentFindings && (status || blockingFindings.length > 0)) {
    throw new Error('[cc-nexs] --document-findings derives the Review status; do not pass --passed, --blocked, or --finding');
  }
  if (!documentFindings && notReproduced.length > 0) throw new Error('[cc-nexs] --not-reproduced requires --document-findings');
  const context = resolveCandidateContext({ cwd, featureId, progressPath });
  releaseScope(context.progress, context.progressFile);
  // Lean reviews the exact candidate after it is verified in test. A standard-lane task
  // that was already reviewing before test when it upgraded may finish that Review.
  if (context.progress.mode === 'lean') {
    assertPlanApprovalCurrent(context.progress, dirname(context.progressFile));
    const fingerprint = candidateFingerprint(context.source);
    const legacyPreTestReview = approvedPlanDeliveryLane(context.progress, dirname(context.progressFile)) === 'standard'
      && ['LOCAL_VERIFYING', 'CONSOLIDATED_REVIEW'].includes(context.progress.state)
      && !(context.progress.delivery?.test?.attempts || []).some((item) => item.fingerprint === fingerprint && !item.invalidated_at);
    if (!closure && !gatewayBDelta && !legacyPreTestReview) {
      const attempt = context.progress.delivery?.test?.attempts?.at(-1);
      assertTestAttemptNotInvalidated(attempt);
      const deployedForManualVerification = attempt?.status === 'deployed_needs_manual_verification'
        && attempt.verification?.result === 'manual_required'
        && attempt.deployment?.environment === (attempt.environment || 'test')
        && Object.keys(attempt.pipeline || {}).length > 0
        && Object.keys(attempt.environment_revision || {}).length > 0;
      if ((!deployedForManualVerification && attempt?.status !== 'verified')
        || attempt.fingerprint !== candidateFingerprint(context.source)) {
        throw new Error('[cc-nexs] consolidated Review requires verified test or a deployed manual-verification attempt for the exact candidate');
      }
    }
  }
  else if (context.progress.mode === 'hotfix') {
    assertHotfixScopeCurrent(context.progress, dirname(context.progressFile));
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
        : ['RELEASE_PENDING_HUMAN', 'LOCAL_VERIFYING', 'CONSOLIDATED_REVIEW', 'TEST_VERIFIED', 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY'];
  if (!expectedStates.includes(context.progress.state)) {
    throw new Error(`[cc-nexs] ${closure ? 'review closure' : 'consolidated review'} requires ${expectedStates.join(' or ')}, found ${context.progress.state}`);
  }
  const localChecks = extractLocalVerificationChecks(releaseScope(context.progress, context.progressFile));
  assertRecordedLocalVerification(context.progress, { source: context.source, fingerprint: candidateFingerprint(context.source), expectedChecks: localChecks });
  let findings = null;
  const featureDir = dirname(context.progressFile);
  const document = context.progress.mode === 'hotfix' ? resolveHotfixDocument(context.progress, featureDir) : join(featureDir, 'plan.md');
  const documentText = readFileSync(document, 'utf8');
  if (!documentFindings && hasReviewBlock(documentText)) {
    throw new Error('[cc-nexs] the review document has a `cc-nexs-review` block; record it with --document-findings instead of --passed/--blocked');
  }
  if (documentFindings) {
    const round = gatewayBDelta ? 'gateway-b-delta' : closure ? 'closure' : 'consolidated';
    const runtime = detectRuntime();
    const panel = resolveReviewPanel(context.config.mergedReview, runtime);
    findings = readReviewFindings(documentText, { round, source: context.source, panel, notReproduced });
    assertReviewerResults(context, round, findings.reviewers, runtime);
    blockingFindings = findings.blockingFindings;
    status = blockingFindings.length > 0 ? 'blocked' : 'passed';
  }
  return recordConsolidatedReview(context.progressFile, {
    source: context.source,
    status,
    blockingFindings,
    findings,
    closure: context.progress.mode === 'hotfix' ? (closure || gatewayBDelta) : closure,
    gatewayBDelta: context.progress.mode === 'hotfix' ? false : gatewayBDelta,
    expectedRevision: context.progress.revision,
  });
}

export function recordLeanPlanReview({ cwd = process.cwd(), featureId, progressPath = null, status, blockingFindings = [], reason = null } = {}) {
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const progress = readProgressV2(progressFile);
  const binding = planApprovalBinding(dirname(progressFile), { requireRiskTier: true, requireDeliveryLane: true });
  if (status === 'skipped' && !['low', 'medium'].includes(binding.risk_tier)) {
    throw new Error(`[cc-nexs] a ${binding.risk_tier} plan requires an independent plan review; only low/medium plans may skip it`);
  }
  const after = recordPlanReview(progressFile, {
    planSha256: binding.combined_sha256, status, blockingFindings, reason, expectedRevision: progress.revision,
  });
  return { kind: 'plan-review', feature: after.feature, status, rounds: after.plan_review.rounds, state: after.state, progressFile };
}
