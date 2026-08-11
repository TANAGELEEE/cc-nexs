import { dirname, join, resolve } from 'node:path';

import { resolveCandidateContext } from './candidate-context.mjs';
import { assertHotfixScopeCurrent } from './hotfix-contract.mjs';
import {
  assertCandidateContainsRemoteBase,
  cleanupMergedWorktree,
  integrateCandidateToTest,
} from './git-custodian.mjs';
import {
  beginBaseRelease,
  candidateFingerprint,
  completeBaseRelease,
  readProgressV2,
  recordBaseIntegration,
} from './progress-v2.mjs';
import { assertPlanApprovalCurrent } from './plan-contract.mjs';
import { transitionState } from './progress-io.mjs';
import { resolveFeatureProgress } from './approval-command.mjs';

export function runBaseRelease({ cwd = process.cwd(), featureId, progressPath = null } = {}) {
  // Code candidates are the immutable, test-verified release payload. The docs
  // worktree contains the live progress ledger, so it is finalized and merged
  // last by Git Custodian after the orchestrator records COMPLETE.
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const initial = readProgressV2(progressFile);
  if (!['lean', 'hotfix'].includes(initial.mode)) throw new Error(`[cc-nexs] base release requires lean or hotfix mode, found ${initial.mode}`);
  const mergeState = initial.mode === 'hotfix' ? 'HOTFIX_BASE_MERGING' : 'BASE_MERGING';
  if (initial.state !== mergeState) throw new Error(`[cc-nexs] base release requires ${mergeState}, found ${initial.state}`);
  const failureContext = { progressFile, progress: initial };
  try {
    const context = resolveCandidateContext({ cwd, featureId, progressPath: progressFile, includeDocs: false });
    if (context.progress.mode === 'lean') assertPlanApprovalCurrent(context.progress, dirname(context.progressFile));
    else assertHotfixScopeCurrent(context.progress, dirname(context.progressFile));
    return executeBaseRelease(context);
  } catch (error) {
    persistBaseReleaseFailure(failureContext, mergeState, error);
    throw error;
  }
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
  if (context.progress.mode === 'hotfix' && context.progress.hotfix?.severity === 'P3') {
    const localAttempt = context.progress.local_verification?.attempts?.findLast((item) => item.status === 'passed' && item.fingerprint === currentFingerprint);
    if (!localAttempt?.evidence?.some((item) => item?.type === 'p3_boundary' && item.files === 1 && item.lines <= 20)) {
      throw new Error('[cc-nexs] approved P3 candidate no longer has deterministic boundary evidence');
    }
  } else if (context.progress.review?.status !== 'passed' || context.progress.review.candidate_fingerprint !== currentFingerprint) {
    throw new Error('[cc-nexs] approved candidate no longer has a passing consolidated Review');
  }
  const testAttempt = context.progress.delivery?.test?.attempts?.find((item) => item.id === gate.binding.test_attempt);
  if (!testAttempt || testAttempt.status !== 'verified' || testAttempt.fingerprint !== currentFingerprint) {
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
    assertCandidateContainsRemoteBase({
      repo: item.repository.absolute_path,
      candidateRef: item.assignment.candidate.ref,
      baseBranch: baseTargets[item.id],
    });
  }

  const attempt = beginBaseRelease(context.progressFile, {
    source: context.source,
    expectedRevision: context.progress.revision,
  });
  try {
    for (const item of context.repositories) {
      const result = integrateCandidateToTest({
        repo: item.repository.absolute_path,
        repositoryId: item.id,
        candidateRef: item.assignment.candidate.ref,
        expectedSourceCommit: item.sourceCommit,
        targetBranch: baseTargets[item.id],
        requireTargetAncestor: true,
      });
      recordBaseIntegration(context.progressFile, {
        attemptId: attempt.id,
        repository: item.id,
        integration: {
          source_commit: result.sourceCommit,
          target_branch: result.targetBranch,
          target_before: result.targetBefore,
          integration_commit: result.remoteCommit || result.integrationCommit,
        },
      });
    }
    completeBaseRelease(context.progressFile, { attemptId: attempt.id, status: 'succeeded' });
  } catch (error) {
    completeBaseRelease(context.progressFile, { attemptId: attempt.id, status: 'failed', reason: error.message });
    throw error;
  }

  for (const item of context.repositories) {
    cleanupMergedWorktree({
      repo: item.repository.absolute_path,
      worktree: resolve(context.workspaceRoot, item.assignment.worktree),
      branch: item.assignment.branch,
      baseBranch: baseTargets[item.id],
      candidateRef: item.assignment.candidate.ref,
      deleteRemote: true,
    });
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
