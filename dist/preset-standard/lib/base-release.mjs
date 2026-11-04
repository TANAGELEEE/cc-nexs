import { releaseScope } from './release-scope.mjs';
import { execFileSync } from 'node:child_process';
import { acquireTestReleaseLock, reclaimTestConflictWorktrees } from './test-release.mjs';
import { dirname, join, resolve } from 'node:path';

import { resolveCandidateContext } from './candidate-context.mjs';
import {
  assertCandidateExcludesTestHistory,
  checkBaseReadiness,
  cleanupMergedWorktree,
  integrateCandidateToTest,
  promoteCandidateViaMergeRequest,
} from './git-custodian.mjs';
import {
  beginBaseRelease,
  assertTestAttemptNotInvalidated,
  candidateFingerprint,
  completeBaseRelease,
  readProgressV2,
  recordBaseIntegration,
} from './progress-v2.mjs';
import { assertRecordedLocalVerification, extractLocalVerificationChecks } from './local-evidence.mjs';
import { transitionState } from './progress-io.mjs';
import { resolveFeatureProgress } from './approval-command.mjs';
import { assertReleaseExceptionCurrent } from './release-exception.mjs';

export function runBaseRelease({ cwd = process.cwd(), featureId, progressPath = null } = {}) {
  // Code candidates are the immutable, approved release payload. The docs
  // worktree contains the live progress ledger, so it is finalized and merged
  // last by Git Custodian after the orchestrator records COMPLETE.
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const initial = readProgressV2(progressFile);
  if (initial.delivery?.base?.status === 'succeeded') {
    const context = resolveCandidateContext({ cwd, featureId, progressPath: progressFile, includeDocs: false });
    const attempt = initial.delivery.base.attempts.at(-1);
    if (candidateFingerprint(context.source) !== attempt.fingerprint) throw new Error('[cc-nexs] candidate changed after successful base release');
    return { kind: 'base-release', status: 'succeeded', feature: initial.feature, attempt, progressFile, docsFinalizationRequired: Boolean(context.workspace.docs_repository) };
  }

  const mergeState = initial.mode === 'hotfix' ? 'HOTFIX_BASE_MERGING' : 'BASE_MERGING';
  if (![mergeState, initial.mode === 'hotfix' ? 'HOTFIX_BASE_MERGE_BLOCKED' : 'BASE_MERGE_BLOCKED'].includes(initial.state)) throw new Error(`[cc-nexs] base release requires ${mergeState}, found ${initial.state}`);
  const failureContext = { progressFile, progress: initial };
  const unlock = acquireTestReleaseLock(progressFile);
  try {
    const context = resolveCandidateContext({ cwd, featureId, progressPath: progressFile, includeDocs: false });
    releaseScope(context.progress, context.progressFile);
    return executeBaseRelease(context);
  } catch (error) {
    persistBaseReleaseFailure(failureContext, mergeState, error);
    throw error;
  } finally { unlock(); }
}

function executeBaseRelease(context) {
  const gate = context.progress.gates?.release;
  if (!gate?.approved || !gate.binding) throw new Error('[cc-nexs] release gate approval is required');
  if (context.progress.mode === 'hotfix' && gate.binding.hotfix_scope_binding !== context.progress.hotfix.scope_binding.hotfix_scope_sha256) {
    throw new Error('[cc-nexs] approved hotfix scope binding is missing or stale');
  }
  const testedSource = gate.binding.source || {};
  const currentFingerprint = candidateFingerprint(context.source);
  if (currentFingerprint !== gate.binding.candidate_fingerprint) {
    throw new Error('[cc-nexs] candidate fingerprint changed after release approval');
  }
  if (context.progress.review?.status !== 'passed' || context.progress.review.candidate_fingerprint !== currentFingerprint) {
    throw new Error('[cc-nexs] approved candidate no longer has a passing consolidated Review');
  }
  const localChecks = extractLocalVerificationChecks(releaseScope(context.progress, context.progressFile));
  assertRecordedLocalVerification(context.progress, { source: context.source, fingerprint: currentFingerprint, expectedChecks: localChecks });
  const testAttempt = context.progress.delivery?.test?.attempts?.find((item) => item.id === gate.binding.test_attempt);
  assertTestAttemptNotInvalidated(testAttempt);
  if (gate.binding.test_exception) {
    assertReleaseExceptionCurrent(context.progress, gate.binding);
  } else if (!testAttempt || testAttempt.status !== 'verified' || testAttempt.fingerprint !== currentFingerprint) {
    throw new Error('[cc-nexs] approved test verification is missing or stale');
  }
  if (Object.keys(testedSource).length !== Object.keys(context.source).length) {
    throw new Error('[cc-nexs] candidate repository set changed after release approval');
  }
  for (const [repository, commit] of Object.entries(testedSource)) {
    if (context.source[repository] !== commit) {
      throw new Error(`[cc-nexs] candidate changed after release approval for ${repository}`);
    }
  }
  const baseTargets = resolveApprovedBaseTargets({
    binding: gate.binding,
    repositories: context.repositories,
    testedSource,
  });
  for (const item of context.repositories) {
    assertCandidateExcludesTestHistory({
      repo: item.repository.absolute_path,
      sourceCommit: item.sourceCommit,
      baseBranch: baseTargets[item.id],
      testBranches: [
        item.repository.test_branch,
        context.progress.delivery?.test?.target?.branches?.[item.id],
        testAttempt?.integrations?.[item.id]?.targetBranch,
      ],
    });
  }

  const attempt = beginBaseRelease(context.progressFile, {
    source: context.source,
    expectedRevision: context.progress.revision,
  });
  const mergeRequest = mergeRequestDriver(context.config, context.workspaceRoot);
  const verifyIntegration = integrationVerifyDriver(context.config, context.workspaceRoot);
  try {
    for (const item of context.repositories) {
      const options = {
        repo: item.repository.absolute_path,
        repositoryId: item.id,
        candidateRef: item.assignment.candidate.ref,
        expectedSourceCommit: item.sourceCommit,
        targetBranch: baseTargets[item.id],
        verifyIntegration,
      };
      const result = mergeRequest
        ? promoteCandidateViaMergeRequest({ ...options, branch: item.assignment.branch, mergeRequest })
        : integrateCandidateToTest({ ...options, requireDisjointTargetChanges: true });
      const previous = attempt.integrations[item.id] || null;
      const integration = baseIntegrationRecord(result, previous);
      if (integration) recordBaseIntegration(context.progressFile, { attemptId: attempt.id, repository: item.id, integration });
      if (result.pending) {
        return { kind: 'base-release', status: 'running', feature: context.progress.feature, attempt: readProgressV2(context.progressFile).delivery.base.attempts.at(-1), progressFile: context.progressFile };
      }
    }
    // Cleanup is part of success, not a best-effort operation after success.
  } catch (error) {
    completeBaseRelease(context.progressFile, { attemptId: attempt.id, status: 'failed', reason: error.message });
    throw error;
  }

  try {
    for (const item of context.repositories) {
      cleanupMergedWorktree({ repo: item.repository.absolute_path, worktree: resolve(context.workspaceRoot, item.assignment.worktree), branch: item.assignment.branch, baseBranch: baseTargets[item.id], candidateRef: null, deleteRemote: true });
    }
    reclaimTestConflictWorktrees(context);
    completeBaseRelease(context.progressFile, { attemptId: attempt.id, status: 'succeeded' });
  } catch (error) {
    completeBaseRelease(context.progressFile, { attemptId: attempt.id, status: 'failed', reason: error.message });
    throw error;
  }

  const progress = readProgressV2(context.progressFile);
  return {
    kind: 'base-release',
    feature: progress.feature,
    status: progress.delivery.base.status,
    attempt: progress.delivery.base.attempts.at(-1),
    docsFinalizationRequired: Boolean(context.workspace.docs_repository),
    progressFile: context.progressFile,
  };
}

// States where a tested candidate waits for, or is about to request, Gateway B.
const PREFLIGHT_STATES = {
  lean: new Set(['CANDIDATE_READY', 'TEST_VERIFIED', 'TEST_DEPLOYED_NEEDS_MANUAL_VERIFY', 'RELEASE_PENDING_HUMAN']),
  hotfix: new Set(['HOTFIX_TEST_VERIFIED', 'HOTFIX_TEST_DEPLOYED_NEEDS_MANUAL_VERIFY', 'HOTFIX_RELEASE_PENDING_HUMAN']),
};

// Read-only base check run before Gateway B is requested. A base that can no
// longer take the candidate unchanged moves the task to BASE_CHANGED so sync
// happens before the human is asked, not after they approve.
export function preflightBaseRelease({ cwd = process.cwd(), featureId, progressPath = null } = {}) {
  const context = resolveCandidateContext({ cwd, featureId, progressPath, includeDocs: false });
  const results = context.repositories.map((item) => checkBaseReadiness({
    repo: item.repository.absolute_path,
    repositoryId: item.id,
    sourceCommit: item.sourceCommit,
    targetBranch: item.assignment.base_branch || item.repository.base_branch,
  }));
  const drift = results.filter((item) => item.status === 'base_changed');
  const { progress } = context;
  let state = progress.state;
  if (drift.length && PREFLIGHT_STATES[progress.mode]?.has(state)) {
    const to = progress.mode === 'hotfix' ? 'HOTFIX_BASE_CHANGED' : 'BASE_CHANGED';
    transitionState(join(dirname(context.progressFile), 'progress.md'), {
      from: state,
      to,
      reason: `base preflight before Gateway B: ${drift.map((item) => `${item.repository}: ${item.reason}`).join('; ')}`,
    });
    state = to;
  }
  return {
    kind: 'base-preflight',
    feature: progress.feature,
    status: drift.length ? 'base_changed' : 'ready',
    state,
    results,
    progressFile: context.progressFile,
  };
}

export function mergeRequestDriver(config, workspaceRoot) {
  const driver = config.mergedRelease?.base?.driver;
  if (!driver) return null;
  return (payload) => JSON.parse(execFileSync(driver.command, driver.args || [], {
    cwd: workspaceRoot, encoding: 'utf8', timeout: 120000,
    input: JSON.stringify({ operation: 'ensure_merge_request', ...payload }),
  }));
}

export function integrationVerifyDriver(config, workspaceRoot) {
  const driver = config.mergedRelease?.base?.verify_driver;
  if (!driver) return null;
  return (payload) => JSON.parse(execFileSync(driver.command, driver.args || [], {
    cwd: workspaceRoot, encoding: 'utf8', timeout: 120000,
    input: JSON.stringify({ operation: 'verify_base_integration', ...payload }),
  }));
}

// A rerun must not rewrite what the first integration recorded: the original
// target_before and MR stay, and only the outcome (merge commit, status) is added.
function baseIntegrationRecord(result, previous) {
  if (result.alreadyIntegrated && previous) return null;
  const mergeRequest = result.mergeRequest || previous?.merge_request || null;
  return {
    source_commit: result.sourceCommit,
    ...(result.sourceBranch && { source_branch: result.sourceBranch }),
    target_branch: result.targetBranch,
    target_before: previous?.target_before || result.targetBefore,
    integration_commit: result.pending ? null : result.mergeCommit || result.remoteCommit || result.integrationCommit,
    merge_relation: result.pending ? null : result.relation || (result.alreadyIntegrated ? 'already-contained' : 'merge'),
    remote_commit: result.remoteCommit || null,
    merge_request: mergeRequest && { ...mergeRequest, status: result.pending ? 'pending' : 'merged' },
    integration_verification: result.integrationVerification || previous?.integration_verification || null,
    ...((result.unverifiedSensitivePaths || previous?.unverified_sensitive_paths) && { unverified_sensitive_paths: result.unverifiedSensitivePaths || previous.unverified_sensitive_paths }),
  };
}

function persistBaseReleaseFailure(context, mergeState, error) {
  const current = readProgressV2(context.progressFile);
  if (current.state !== mergeState) return;
  const baseChanged = /\bBASE_CHANGED\b/.test(error?.message || '');
  const blockedState = context.progress.mode === 'hotfix'
    ? (baseChanged ? 'HOTFIX_BASE_CHANGED' : 'HOTFIX_BASE_MERGE_BLOCKED')
    : (baseChanged ? 'BASE_CHANGED' : 'BASE_MERGE_BLOCKED');
  transitionState(join(dirname(context.progressFile), 'progress.md'), {
    from: mergeState,
    to: blockedState,
    reason: error?.message || 'base release failed',
  });
}

function resolveApprovedBaseTargets({ binding, repositories, testedSource }) {
  const hasApprovedTargets = Object.prototype.hasOwnProperty.call(binding, 'base_targets');
  const approvedTargets = binding.base_targets;
  if (hasApprovedTargets && (!approvedTargets || typeof approvedTargets !== 'object' || Array.isArray(approvedTargets))) {
    throw new Error('[cc-nexs] approved base target binding is invalid');
  }

  const expectedRepositories = Object.keys(testedSource).sort();
  if (hasApprovedTargets) {
    const boundRepositories = Object.keys(approvedTargets).sort();
    if (JSON.stringify(boundRepositories) !== JSON.stringify(expectedRepositories)) {
      throw new Error('[cc-nexs] approved base target repository set does not match the tested candidate');
    }
  }

  const targets = {};
  for (const item of repositories) {
    // Progress v2 assignments already captured the base branch when the candidate
    // worktree was created. That is the only safe fallback for approvals created
    // before Gateway B started persisting base_targets.
    const assignedTarget = item.assignment.base_branch;
    if (typeof assignedTarget !== 'string' || !assignedTarget.trim()) {
      throw new Error(`[cc-nexs] candidate assignment has no bound base branch for ${item.id}`);
    }
    const approvedTarget = hasApprovedTargets ? approvedTargets[item.id] : assignedTarget;
    if (typeof approvedTarget !== 'string' || !approvedTarget.trim()) {
      throw new Error(`[cc-nexs] approved base target is missing for ${item.id}`);
    }
    if (assignedTarget !== approvedTarget) {
      throw new Error(`[cc-nexs] candidate assignment base branch changed after release approval for ${item.id}`);
    }
    if (item.repository.base_branch !== approvedTarget) {
      throw new Error(`[cc-nexs] workspace base branch changed after release approval for ${item.id}`);
    }
    targets[item.id] = approvedTarget;
  }
  return targets;
}
