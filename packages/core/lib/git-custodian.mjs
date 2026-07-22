import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { gitIdentityEnv, resolveGitIdentity } from './git-identity.mjs';
import { recordRepositoryCandidatePrepared } from './progress-v2.mjs';

function git(repo, args, options = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    env: options.env || process.env,
  }).trim();
}

function assertSegment(value, label) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value || '')) throw new Error(`[cc-nexs] invalid ${label}: ${value}`);
  return value;
}

function assertWithin(root, target) {
  const rel = relative(resolve(root), resolve(target));
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || resolve(rel) === rel) {
    throw new Error(`[cc-nexs] unsafe worktree path: ${target}`);
  }
  return target;
}

function refExists(repo, ref) {
  try { git(repo, ['show-ref', '--verify', '--quiet', ref]); return true; } catch { return false; }
}

function remoteBranchExists(repo, branch) {
  try { return Boolean(git(repo, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])); } catch { return false; }
}

function fetchBase(repo, branch) {
  assertSegment(branch, 'base branch');
  try {
    git(repo, ['fetch', '--prune', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  } catch {
    throw new Error(`[cc-nexs] cannot fetch origin/${branch}; refusing to use the caller's current HEAD`);
  }
  const remote = `refs/remotes/origin/${branch}`;
  if (!refExists(repo, remote)) throw new Error(`[cc-nexs] remote base branch not found: origin/${branch}`);
  return remote;
}

export function createWorkspaceWorktrees(workspace, { featureId, featureSlug, repositoryIds = null }) {
  assertSegment(featureId, 'feature id');
  assertSegment(featureSlug, 'feature slug');
  const featureKey = `${featureId}-${featureSlug}`;
  const featureRoot = assertWithin(workspace.worktree_root, join(workspace.worktree_root, featureKey));
  mkdirSync(featureRoot, { recursive: true });
  const selectedIds = repositoryIds || (workspace.docs_repository ? [workspace.docs_repository] : workspace.repositories.map((repo) => repo.id));
  const unknown = selectedIds.filter((id) => !workspace.repositories.some((repo) => repo.id === id));
  if (unknown.length) throw new Error(`[cc-nexs] unknown repositories: ${unknown.join(', ')}`);
  const selected = workspace.repositories.filter((repo) => selectedIds.includes(repo.id));
  const created = [];
  try {
    for (const repo of selected) {
      const branch = `feature/${featureKey}`;
      const worktree = assertWithin(workspace.worktree_root, join(featureRoot, assertSegment(repo.id, 'repository id')));
      if (existsSync(worktree)) throw new Error(`[cc-nexs] worktree path already exists: ${worktree}`);
      if (refExists(repo.absolute_path, `refs/heads/${branch}`)) throw new Error(`[cc-nexs] branch already exists in ${repo.id}: ${branch}`);
      const base = fetchBase(repo.absolute_path, repo.base_branch);
      const baseCommit = git(repo.absolute_path, ['rev-parse', base]);
      git(repo.absolute_path, ['worktree', 'add', '--no-track', '-b', branch, worktree, base]);
      created.push({ repository: repo.id, source: repo.absolute_path, branch, worktree, baseBranch: repo.base_branch, baseCommit });
    }
    return created;
  } catch (error) {
    for (const item of created.reverse()) {
      try { git(item.source, ['worktree', 'remove', '--force', item.worktree]); } catch {}
      try { git(item.source, ['branch', '-D', item.branch]); } catch {}
    }
    throw error;
  }
}

export function commitCandidate({ repositoryId, repo, worktree, branch, featureKey, paths, message, progressFile = null }) {
  assertSegment(repositoryId, 'repository id');
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('[cc-nexs] candidate paths are required');
  const registered = git(repo, ['worktree', 'list', '--porcelain']);
  const realWorktree = realpathSync(worktree);
  if (!registered.split('\n').includes(`worktree ${realWorktree}`)) throw new Error('[cc-nexs] unregistered worktree');
  if (git(worktree, ['branch', '--show-current']) !== branch) throw new Error(`[cc-nexs] worktree branch mismatch: expected ${branch}`);
  const identity = resolveGitIdentity(repo);
  if (git(worktree, ['diff', '--cached', '--name-only'])) {
    throw new Error('[cc-nexs] refusing candidate while unrelated staged changes exist');
  }
  for (const file of paths) {
    const absolute = resolve(realWorktree, file || '');
    const rel = relative(realWorktree, absolute);
    if (typeof file !== 'string' || !file || rel === '..' || rel.startsWith(`..${sep}`) || resolve(rel) === rel) {
      throw new Error(`[cc-nexs] unsafe candidate path: ${file}`);
    }
  }
  git(worktree, ['add', '--', ...paths]);
  let staged = git(worktree, ['diff', '--cached', '--name-only']);
  if (!staged) throw new Error('[cc-nexs] candidate has no staged changes');
  const candidateRef = `refs/cc-nexs/candidates/${assertSegment(featureKey, 'feature key')}/${repositoryId}`;
  let progressInsideWorktree = false;
  if (progressFile) {
    const progressReal = realpathSync(progressFile);
    const progressRel = relative(realWorktree, progressReal);
    if (progressRel && progressRel !== '..' && !progressRel.startsWith(`..${sep}`) && resolve(progressRel) !== progressRel) {
      progressInsideWorktree = true;
      recordRepositoryCandidatePrepared(progressFile, repositoryId, {
        candidateRef,
        staged: staged.split('\n'),
      });
      git(worktree, ['add', '--', progressRel]);
      staged = git(worktree, ['diff', '--cached', '--name-only']);
    }
  }
  const raw = git(worktree, ['diff', '--cached', '--raw']);
  if (/\b120000\b/.test(raw)) {
    git(worktree, ['reset']);
    throw new Error('[cc-nexs] refusing candidate containing a symbolic link');
  }
  git(worktree, ['commit', '-m', message], { env: gitIdentityEnv(identity) });
  const commit = git(worktree, ['rev-parse', 'HEAD']);
  git(repo, ['update-ref', candidateRef, commit]);
  if (progressFile && !progressInsideWorktree) {
    recordRepositoryCandidatePrepared(progressFile, repositoryId, {
      candidateRef,
      staged: staged.split('\n'),
    });
  }
  return { branch, commit, candidateRef, staged: staged.split('\n') };
}

export function prepareFeatureForMerge({ repo, worktree, branch, baseBranch, candidateRef = null }) {
  const realWorktree = realpathSync(worktree);
  const registered = git(repo, ['worktree', 'list', '--porcelain']);
  if (!registered.split('\n').includes(`worktree ${realWorktree}`)) throw new Error('[cc-nexs] unregistered worktree');
  if (git(worktree, ['branch', '--show-current']) !== branch) throw new Error(`[cc-nexs] worktree branch mismatch: expected ${branch}`);
  if (git(worktree, ['status', '--porcelain'])) throw new Error('[cc-nexs] refusing base synchronization for dirty worktree');
  const base = fetchBase(repo, baseBranch);
  const oldHead = git(worktree, ['rev-parse', 'HEAD']);
  try {
    if (!isAncestor(repo, base, `refs/heads/${branch}`)) {
      const identity = resolveGitIdentity(repo);
      git(worktree, ['merge', '--no-edit', base], { env: gitIdentityEnv(identity) });
    }
  } catch {
    try { git(worktree, ['merge', '--abort']); } catch {}
    throw new Error(`[cc-nexs] ${branch} conflicts with latest origin/${baseBranch}; resolve before release`);
  }
  const head = git(worktree, ['rev-parse', 'HEAD']);
  if (candidateRef) git(repo, ['update-ref', candidateRef, head]);
  return { branch, baseBranch, baseCommit: git(repo, ['rev-parse', base]), oldHead, head, updated: oldHead !== head };
}

function isAncestor(repo, ancestor, descendant) {
  try { git(repo, ['merge-base', '--is-ancestor', ancestor, descendant]); return true; } catch { return false; }
}

export function cleanupMergedWorktree({ repo, worktree, branch, baseBranch, candidateRef = null, deleteRemote = false }) {
  const realWorktree = realpathSync(worktree);
  const registered = git(repo, ['worktree', 'list', '--porcelain']);
  if (!registered.split('\n').includes(`worktree ${realWorktree}`)) throw new Error('[cc-nexs] refusing cleanup of unregistered worktree');
  if (git(worktree, ['status', '--porcelain'])) throw new Error('[cc-nexs] refusing cleanup of dirty worktree');
  const base = fetchBase(repo, baseBranch);
  try { git(repo, ['merge-base', '--is-ancestor', `refs/heads/${branch}`, base]); }
  catch { throw new Error(`[cc-nexs] branch is not merged into ${baseBranch}`); }
  let remoteBranchDeleted = false;
  if (deleteRemote && remoteBranchExists(repo, branch)) {
    git(repo, ['fetch', 'origin',
      `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`,
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    try { git(repo, ['merge-base', '--is-ancestor', `refs/remotes/origin/${branch}`, `refs/remotes/origin/${baseBranch}`]); }
    catch { throw new Error(`[cc-nexs] remote branch is not merged into origin/${baseBranch}`); }
    git(repo, ['push', 'origin', '--delete', branch]);
    remoteBranchDeleted = true;
  }
  git(repo, ['worktree', 'remove', worktree]);
  // The primary checkout may be on test/develop. `branch -d` compares against
  // that checkout and can reject a branch already proven merged into origin/base.
  // The fresh remote ancestry proof above is authoritative, so force-delete the
  // local ref after removing its worktree.
  git(repo, ['branch', '-D', branch]);
  if (candidateRef && refExists(repo, candidateRef)) git(repo, ['update-ref', '-d', candidateRef]);
  git(repo, ['worktree', 'prune']);
  return { removed: worktree, branchDeleted: branch, remoteBranchDeleted };
}

// This entry point is reserved for an explicitly authorized release merge.
// A release is complete only after both local and remote feature refs are gone;
// callers that merely want local cleanup must use cleanupMergedWorktree().
export function finalizeMergedWorktree(args) {
  return cleanupMergedWorktree({ ...args, deleteRemote: args.keepRemote !== true });
}
