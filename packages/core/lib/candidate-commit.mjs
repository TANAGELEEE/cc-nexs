// `cc-nexs commit-candidate` commits the declared paths of one assigned worktree as the
// task's candidate. The Orchestrator had no command for this step and imported
// git-custodian.mjs to call commitCandidate, which is how hand-written control scripts
// began; the branch, worktree and candidate ref all come from progress here.

import { resolve } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { findWorkspaceRoot } from './candidate-context.mjs';
import { loadWorkspaceConfig } from './config-loader.mjs';
import { commitCandidate } from './git-custodian.mjs';
import { readProgressV2 } from './progress-v2.mjs';

export function commitTaskCandidate({ cwd = process.cwd(), featureId, progressPath = null, repositoryId, paths = [], message } = {}) {
  if (!repositoryId) throw new Error('[cc-nexs] commit-candidate requires --repo <repository-id>');
  if (!message?.trim()) throw new Error('[cc-nexs] commit-candidate requires --message');
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const root = findWorkspaceRoot(cwd, progressFile);
  const workspace = loadWorkspaceConfig({ projectRoot: root });
  const progress = readProgressV2(progressFile);
  const assignment = progress.repositories?.[repositoryId];
  const repository = workspace.repositories.find((item) => item.id === repositoryId);
  if (!repository || !assignment?.worktree || !assignment.branch) {
    throw new Error(`[cc-nexs] ${repositoryId} has no assigned worktree in this task (assigned: ${Object.keys(progress.repositories || {}).join(', ') || 'none'})`);
  }
  if (repository.docs === true || repositoryId === workspace.docs_repository) {
    throw new Error('[cc-nexs] the docs candidate is created by finalize-docs, not commit-candidate');
  }
  const featureKey = progress.mode === 'hotfix' ? String(progress.feature.id) : `${progress.feature.id}-${progress.feature.slug}`;
  const result = commitCandidate({
    repositoryId, repo: repository.absolute_path, worktree: resolve(root, assignment.worktree), branch: assignment.branch,
    featureKey, paths, message: message.trim(), progressFile,
  });
  return { kind: 'candidate-commit', feature: progress.feature, repository: repositoryId, ...result };
}
