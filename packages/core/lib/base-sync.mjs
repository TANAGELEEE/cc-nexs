import { resolve } from 'node:path';
import { resolveCandidateContext } from './candidate-context.mjs';
import { prepareFeatureForMerge } from './git-custodian.mjs';
import { acquireTestReleaseLock } from './test-release.mjs';
import { appendProgressEvent, readProgressV2, recordRepositoryCandidatePrepared } from './progress-v2.mjs';

export function syncReleaseBase(options) {
  const context = resolveCandidateContext(options);
  const unlock = acquireTestReleaseLock(context.progressFile);
  try {
    const progress = readProgressV2(context.progressFile);
    if (!['BASE_CHANGED', 'HOTFIX_BASE_CHANGED'].includes(progress.state)) throw new Error('sync-base requires BASE_CHANGED');
    const results = [];
    for (const item of context.repositories) {
      const result = prepareFeatureForMerge({ repo: item.repository.absolute_path,
        worktree: resolve(context.workspaceRoot, item.assignment.worktree), branch: item.assignment.branch,
        baseBranch: item.assignment.base_branch, candidateRef: item.assignment.candidate.ref, preserveConflicts: true });
      results.push({ repository: item.id, ...result });
      recordRepositoryCandidatePrepared(context.progressFile, item.id, {
        candidateRef: item.assignment.candidate.ref, staged: item.assignment.candidate.paths || [],
      });
    }
    const conflicts = results.some(item => item.status === 'conflicts');
    const state = progress.mode === 'hotfix'
      ? (conflicts ? 'HOTFIX_FIXING' : 'HOTFIX_LOCAL_VERIFYING')
      : (conflicts ? 'IMPLEMENTING' : 'LOCAL_VERIFYING');
    appendProgressEvent(context.progressFile, { type: 'base.synced', from: progress.state, to: state, data: { results } });
    return { kind: 'base-sync', state, conflicts, results, progressFile: context.progressFile };
  } finally { unlock(); }
}
