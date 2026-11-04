// Project verification guides.
//
// A guide (how to launch, check, drive, capture evidence from, and clean up the real
// app) and a feature map are looked up in this order, and the first one found wins:
//
//   1. candidate: the code repository's `.cc-nexs/verify/` in the exact candidate commit;
//   2. docs: the workspace docs repository's `.cc-nexs/verify/<repository-id>/`, read from
//      its committed base branch (`origin/<base>`, else `<base>`);
//   3. workspace: `<workspace>/.cc-nexs/verify/<repository-id>/`, local and unversioned.
//
// `/cc-nexs:verify-skill` writes them.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveCandidateContext } from './candidate-context.mjs';

export const VERIFY_GUIDE = '.cc-nexs/verify/README.md';
const FEATURES_DIR = '.cc-nexs/verify/features/';

function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function gitLines(repo, args) {
  const output = git(repo, args);
  return output === null ? null : output.split('\n').filter(Boolean);
}

function quote(value) {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function featureNames(names) {
  return names.filter((name) => name.endsWith('.md') && name !== 'README.md').map((name) => name.replace(/\.md$/, '')).sort();
}

function readCommittedGuide(repo, commit, guidePath, featuresDir) {
  const guide = gitLines(repo, ['ls-tree', '--name-only', commit, guidePath]);
  if (!guide?.length) return null;
  const features = featureNames((gitLines(repo, ['ls-tree', '--name-only', commit, featuresDir]) || [])
    .map((path) => path.slice(featuresDir.length)));
  return { guide: guidePath, features };
}

export function readVerifyGuide(repo, commit) {
  return readCommittedGuide(repo, commit, VERIFY_GUIDE, FEATURES_DIR) || { guide: null, features: [] };
}

export function readDocsVerifyGuide(docsRepo, baseBranch, repositoryId) {
  const guidePath = `.cc-nexs/verify/${repositoryId}/README.md`;
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    const commit = git(docsRepo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])?.trim();
    if (!commit) continue;
    const found = readCommittedGuide(docsRepo, commit, guidePath, `.cc-nexs/verify/${repositoryId}/features/`);
    return found ? { ref, commit, guide: guidePath, features: found.features } : null;
  }
  return null;
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

function docsRepository(workspace) {
  return workspace.repositories.find((repository) => repository.id === workspace.docs_repository)
    || workspace.repositories.find((repository) => repository.docs === true)
    || null;
}

export function candidateVerifyGuides({ cwd = process.cwd(), featureId, progressPath = null } = {}) {
  const context = resolveCandidateContext({ cwd, featureId, progressPath });
  const docs = docsRepository(context.workspace);
  return {
    kind: 'verify-guides',
    feature: context.progress.feature,
    repositories: context.repositories.map((item) => {
      const base = { id: item.id, commit: item.sourceCommit };
      const worktree = item.assignment.worktree ? resolve(context.workspaceRoot, item.assignment.worktree) : item.repository.absolute_path;
      const candidate = readVerifyGuide(item.repository.absolute_path, item.sourceCommit);
      if (candidate.guide) {
        const path = join(worktree, candidate.guide);
        return { ...base, source: 'candidate', path, read: `git -C ${quote(item.repository.absolute_path)} show ${item.sourceCommit}:${candidate.guide}`, features: candidate.features };
      }
      const fromDocs = docs ? readDocsVerifyGuide(docs.absolute_path, docs.base_branch, item.id) : null;
      if (fromDocs) {
        return { ...base, source: 'docs', path: join(docs.absolute_path, fromDocs.guide), read: `git -C ${quote(docs.absolute_path)} show ${fromDocs.commit}:${fromDocs.guide}`, features: fromDocs.features };
      }
      const workspace = readWorkspaceVerifyGuide(context.workspaceRoot, item.id);
      return { ...base, source: workspace.path ? 'workspace' : null, path: workspace.path, read: workspace.path ? `cat ${quote(workspace.path)}` : null, features: workspace.features };
    }),
  };
}
