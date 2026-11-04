// Project verification guides.
//
// A guide (how to launch, check, drive, capture evidence from, and clean up the real
// app) and a feature map live either in the code repository under `.cc-nexs/verify/`,
// versioned with the code and read from the exact candidate commit, or, when a team
// keeps them out of the repository, in the workspace under
// `.cc-nexs/verify/<repository-id>/`. `/cc-nexs:verify-skill` writes them. A guide in
// the candidate commit wins over a workspace guide.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveCandidateContext } from './candidate-context.mjs';

export const VERIFY_GUIDE = '.cc-nexs/verify/README.md';
const FEATURES_DIR = '.cc-nexs/verify/features/';

function gitLines(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

function featureNames(names) {
  return names.filter((name) => name.endsWith('.md') && name !== 'README.md').map((name) => name.replace(/\.md$/, '')).sort();
}

export function readVerifyGuide(repo, commit) {
  const guide = gitLines(repo, ['ls-tree', '--name-only', commit, VERIFY_GUIDE]);
  const features = featureNames((gitLines(repo, ['ls-tree', '--name-only', commit, FEATURES_DIR]) || [])
    .map((path) => path.slice(FEATURES_DIR.length)));
  return { guide: guide?.length ? VERIFY_GUIDE : null, features };
}

export function workspaceVerifyDir(workspaceRoot, repositoryId) {
  return join(workspaceRoot, '.cc-nexs', 'verify', repositoryId);
}

export function readWorkspaceVerifyGuide(workspaceRoot, repositoryId) {
  const dir = workspaceVerifyDir(workspaceRoot, repositoryId);
  const guide = join(dir, 'README.md');
  if (!existsSync(guide)) return { path: null, features: [] };
  let names = [];
  try { names = readdirSync(join(dir, 'features')); } catch { names = []; }
  return { path: guide, features: featureNames(names) };
}

export function candidateVerifyGuides({ cwd = process.cwd(), featureId, progressPath = null } = {}) {
  const context = resolveCandidateContext({ cwd, featureId, progressPath });
  return {
    kind: 'verify-guides',
    feature: context.progress.feature,
    repositories: context.repositories.map((item) => {
      const worktree = item.assignment.worktree ? resolve(context.workspaceRoot, item.assignment.worktree) : item.repository.absolute_path;
      const candidate = readVerifyGuide(item.repository.absolute_path, item.sourceCommit);
      if (candidate.guide) return { id: item.id, commit: item.sourceCommit, source: 'candidate', path: join(worktree, candidate.guide), features: candidate.features };
      const workspace = readWorkspaceVerifyGuide(context.workspaceRoot, item.id);
      return { id: item.id, commit: item.sourceCommit, source: workspace.path ? 'workspace' : null, path: workspace.path, features: workspace.features };
    }),
  };
}
