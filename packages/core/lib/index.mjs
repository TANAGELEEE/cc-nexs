// cc-nexs core public API.
export { loadConfig, loadWorkspaceConfig, mergeModelConfigs } from './config-loader.mjs';
export { loadI18n } from './i18n.mjs';
export { RoleRegistry } from './role-registry.mjs';
export { planReviewerInvocation } from './reviewer-adapter.mjs';
export { readProgress, transitionState, approveDeployGate, approveHumanGate } from './progress-io.mjs';
export { approveFeatureGate, normalizeSprint, resolveFeatureProgress } from './approval-command.mjs';
export {
  PROGRESS_SCHEMA_VERSION,
  appendProgressEvent,
  beginTestRelease,
  beginBaseRelease,
  completeTestRelease,
  completeBaseRelease,
  approveProgressGate,
  createProgressV2,
  readProgressV2,
  recordRepositoryAssignments,
  recoverApprovedImplementationSprint,
  recordRepositoryCandidate,
  recordRepositoryCandidatePrepared,
  recordLocalVerification,
  recordHotfixBoundaryEvidence,
  recordReleaseChangeRequest,
  recordConsolidatedReview,
  recordBaseIntegration,
  recordTestIntegration,
  recordTestVerification,
  updateProgressCounters,
  validateProgressV2,
  writeProgressV2,
} from './progress-v2.mjs';
export { nextStep, STATES } from './state-machine.mjs';
export {
  cleanupMergedWorktree,
  assertCandidateContainsRemoteBase,
  commitCandidate,
  createWorkspaceWorktrees,
  finalizeMergedWorktree,
  integrateCandidateToTest,
  prepareFeatureForMerge,
  resolveCandidateCommit,
} from './git-custodian.mjs';
export { acquireTestReleaseLock, preflightTestRelease, runTestRelease } from './test-release.mjs';
export { runLocalVerification } from './local-verify.mjs';
export { recordLeanReview } from './review-control.mjs';
export { requestReleaseChanges } from './release-change-command.mjs';
export { runBaseRelease } from './base-release.mjs';
export { assertHotfixCandidate, startHotfix } from './hotfix-control.mjs';
export { HOTFIX_SCOPE_MARKERS, assertHotfixScopeCurrent, assertP3CandidateBoundary, extractHotfixScope, hotfixScopeBinding } from './hotfix-contract.mjs';
export { recordEnvironmentVerification } from './test-verification-control.mjs';
export { renderLeanPlan } from './plan-render.mjs';
export { executeBuildPlan } from './build-executor.mjs';
export { PLAN_SCOPE_MARKERS, approvedPlanRiskTier, assertPlanApprovalCurrent, extractApprovalScope, inspectPlanRiskBinding, planApprovalBinding } from './plan-contract.mjs';
export { nextFeatureId, recordPublishedFeatureReservation, releaseFeatureReservation, reserveFeatureId } from './feature-reservation.mjs';
export { publishDocsReservation } from './docs-reservation.mjs';
export { detectRuntime, resolveRoleRuntime, runtimeContract } from './runtime-resolver.mjs';
export { migrateFeatureConfig } from './feature-config.mjs';
export { syncImplementationWorktrees } from './implementation-worktrees.mjs';
export { beginImplementationDelta, endImplementationDelta, implementationPathAllowed } from './implementation-delta.mjs';
export {
  LEGACY_TEMPLATE_ROLE_MAPS,
  applyModelRouting,
  extractPlanRiskTier,
  hasLegacyTemplateRoleMap,
  normalizeRiskTier,
  resolveApprovedPlanRiskSignal,
  resolveFeatureModelRouting,
  resolveRiskContext,
  validateModelRoutingConfig,
} from './model-routing.mjs';
