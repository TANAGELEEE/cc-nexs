import { dirname, resolve } from 'node:path';

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

export function runBaseRelease({ cwd = process.cwd(), featureId, progressPath = null } = {}) {
  // Code candidates are the immutable, test-verified release payload. The docs
  // worktree contains the live progress ledger, so it is finalized and merged
  // last by Git Custodian after the orchestrator records COMPLETE.
  const context = resolveCandidateContext({ cwd, featureId, progressPath, includeDocs: false });
  if (!['lean', 'hotfix'].includes(context.progress.mode)) throw new Error(`[cc-nexs] base release requires lean or hotfix mode, found ${context.progress.mode}`);
  if (context.progress.mode === 'lean') assertPlanApprovalCurrent(context.progress, dirname(context.progressFile));
  else assertHotfixScopeCurrent(context.progress, dirname(context.progressFile));
  const mergeState = context.progress.mode === 'hotfix' ? 'HOTFIX_BASE_MERGING' : 'BASE_MERGING';
  if (context.progress.state !== mergeState) throw new Error(`[cc-nexs] base release requires ${mergeState}, found ${context.progress.state}`);
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

  for (const item of context.repositories) {
    assertCandidateContainsRemoteBase({
      repo: item.repository.absolute_path,
      candidateRef: item.assignment.candidate.ref,
      baseBranch: item.repository.base_branch,
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
        targetBranch: item.repository.base_branch,
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
      baseBranch: item.repository.base_branch,
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
