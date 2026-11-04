// Project verification guides.
//
// A code repository may carry `.cc-nexs/verify/README.md` (how to launch, check,
// drive, capture evidence from, and clean up the real app) and a feature map under
// `.cc-nexs/verify/features/`. `/cc-nexs:verify-skill` writes them. Verifiers read the
// guide from the exact candidate commit, so verification follows the candidate.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

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

export function readVerifyGuide(repo, commit) {
  const guide = gitLines(repo, ['ls-tree', '--name-only', commit, VERIFY_GUIDE]);
  const features = (gitLines(repo, ['ls-tree', '--name-only', commit, FEATURES_DIR]) || [])
    .map((path) => path.slice(FEATURES_DIR.length))
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => name.replace(/\.md$/, ''))
    .sort();
  return { guide: guide?.length ? VERIFY_GUIDE : null, features };
}

export function candidateVerifyGuides({ cwd = process.cwd(), featureId, progressPath = null } = {}) {
  const context = resolveCandidateContext({ cwd, featureId, progressPath });
  return {
    kind: 'verify-guides',
    feature: context.progress.feature,
    repositories: context.repositories.map((item) => ({
      id: item.id,
      commit: item.sourceCommit,
      worktree: item.assignment.worktree ? resolve(context.workspaceRoot, item.assignment.worktree) : item.repository.absolute_path,
      ...readVerifyGuide(item.repository.absolute_path, item.sourceCommit),
    })),
  };
}
