import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep, win32 } from 'node:path';

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

// Git prints forward-slash paths on Windows while realpath returns backslashes,
// and NTFS paths compare case-insensitively.
export function isWorktreeRegistered(porcelain, worktree, { platform = process.platform, realpath = realpathSync } = {}) {
  const key = (value) => {
    let resolved = value;
    try { resolved = realpath(value); } catch {}
    return platform === 'win32' ? win32.normalize(resolved).toLowerCase() : resolved;
  };
  const expected = key(worktree);
  return porcelain.split(/\r?\n/).some((line) => line.startsWith('worktree ') && key(line.slice('worktree '.length)) === expected);
}

function refExists(repo, ref) {
  try { git(repo, ['show-ref', '--verify', '--quiet', ref]); return true; } catch { return false; }
}

export function resolveCandidateCommit({ repo, candidateRef }) {
  if (typeof candidateRef !== 'string' || !candidateRef.startsWith('refs/cc-nexs/candidates/')) {
    throw new Error(`[cc-nexs] invalid candidate ref: ${candidateRef || '<missing>'}`);
  }
  if (!refExists(repo, candidateRef)) throw new Error(`[cc-nexs] candidate ref not found: ${candidateRef}`);
  return git(repo, ['rev-parse', candidateRef]);
}

function remoteBranchExists(repo, branch) {
  try { return Boolean(git(repo, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])); } catch { return false; }
}

// shortcut: filename heuristics miss custom contracts; use project dependency analysis when available.
export function isSensitiveBasePath(file) {
  const path = String(file || '').replaceAll('\\', '/');
  const name = path.split('/').at(-1);
  return /^(package\.json|package-lock\.json|pnpm-(lock|workspace)\.yaml|yarn\.lock|npm-shrinkwrap\.json|go\.(mod|sum|work)|Cargo\.(toml|lock)|pyproject\.toml|poetry\.lock|uv\.lock|composer\.(json|lock)|Gemfile(\.lock)?|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|requirements[^/]*\.txt)$/.test(name)
    || /(^|\/)(\.github|\.circleci|\.buildkite|migrations?|schemas?|openapi|proto|dto|config|permissions?|generated|contracts?)(\/|$)/i.test(path)
    || /\.(proto|graphql|prisma)$|[.-](dto|schema)\.[^/]+$|(^|\/)openapi\.[^/]+$/i.test(path)
    || /(^|\/)(Dockerfile[^/]*|Makefile|justfile|tsconfig[^/]*\.json|vite\.config\.[^/]+|webpack\.config\.[^/]+|rollup\.config\.[^/]+|\.env[^/]*)$/i.test(path);
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

function recoverExistingWorkspaceWorktree({ workspace, repo, featureRoot, branch }) {
  const worktree = assertWithin(workspace.worktree_root, join(featureRoot, assertSegment(repo.id, 'repository id')));
  const pathExists = existsSync(worktree);
  const branchExists = refExists(repo.absolute_path, `refs/heads/${branch}`);
  if (!pathExists || !branchExists) {
    throw new Error(`[cc-nexs] incomplete existing worktree/branch pair for ${repo.id}; refusing automatic recovery`);
  }
  const realWorktree = realpathSync(worktree);
  assertWithin(realpathSync(workspace.worktree_root), realWorktree);
  const registered = git(repo.absolute_path, ['worktree', 'list', '--porcelain']);
  if (!isWorktreeRegistered(registered, realWorktree)) {
    throw new Error(`[cc-nexs] existing worktree is not registered for ${repo.id}`);
  }
  if (git(worktree, ['branch', '--show-current']) !== branch) {
    throw new Error(`[cc-nexs] existing worktree branch mismatch for ${repo.id}`);
  }
  if (git(worktree, ['status', '--porcelain'])) {
    throw new Error(`[cc-nexs] existing unassigned worktree is dirty for ${repo.id}`);
  }
  const head = git(worktree, ['rev-parse', 'HEAD']);
  const remoteBase = fetchBase(repo.absolute_path, repo.base_branch);
  if (!isAncestor(repo.absolute_path, head, remoteBase)) {
    throw new Error(`[cc-nexs] existing unassigned worktree for ${repo.id} is not an untouched ${repo.base_branch} baseline`);
  }
  return {
    repository: repo.id,
    source: repo.absolute_path,
    branch,
    worktree,
    baseBranch: repo.base_branch,
    baseCommit: head,
    recovered: true,
  };
}

export function createWorkspaceWorktrees(workspace, {
  featureId,
  featureSlug,
  repositoryIds = null,
  recoverExisting = false,
  mode = 'feature',
}) {
  assertSegment(featureId, 'feature id');
  assertSegment(featureSlug, 'feature slug');
  if (!['feature', 'hotfix'].includes(mode)) throw new Error('[cc-nexs] invalid worktree mode');
  const reservationFile = join(workspace.projectRoot, '.cc-nexs', 'reservations', `${featureId}.json`);
  if (mode === 'feature' && !existsSync(reservationFile)) {
    throw new Error(`[cc-nexs] no reservation for feature ${featureId}; run reserve first`);
  }
  const reservation = mode === 'feature' ? JSON.parse(readFileSync(reservationFile, 'utf8')) : null;
  if (reservation && reservation.feature_slug !== featureSlug) {
    throw new Error(`[cc-nexs] feature ${featureId} is reserved for slug "${reservation.feature_slug}", not "${featureSlug}"`);
  }
  const featureKey = mode === 'hotfix' ? featureId : `${featureId}-${featureSlug}`;
  const featureRoot = assertWithin(workspace.worktree_root, join(workspace.worktree_root, featureKey));
  mkdirSync(featureRoot, { recursive: true });
  const selectedIds = repositoryIds || (workspace.docs_repository ? [workspace.docs_repository] : workspace.repositories.map((repo) => repo.id));
  const unknown = selectedIds.filter((id) => !workspace.repositories.some((repo) => repo.id === id));
  if (unknown.length) throw new Error(`[cc-nexs] unknown repositories: ${unknown.join(', ')}`);
  const selected = workspace.repositories.filter((repo) => selectedIds.includes(repo.id));
  const assignments = [];
  const newlyCreated = [];
  try {
    for (const repo of selected) {
      const branch = `${mode}/${featureKey}`;
      const worktree = assertWithin(workspace.worktree_root, join(featureRoot, assertSegment(repo.id, 'repository id')));
      const pathExists = existsSync(worktree);
      const branchExists = refExists(repo.absolute_path, `refs/heads/${branch}`);
      if (pathExists || branchExists) {
        if (!recoverExisting) {
          if (pathExists) throw new Error(`[cc-nexs] worktree path already exists: ${worktree}`);
          throw new Error(`[cc-nexs] branch already exists in ${repo.id}: ${branch}`);
        }
        assignments.push(recoverExistingWorkspaceWorktree({ workspace, repo, featureRoot, branch }));
        continue;
      }
      const base = fetchBase(repo.absolute_path, repo.base_branch);
      const baseCommit = git(repo.absolute_path, ['rev-parse', base]);
      git(repo.absolute_path, ['worktree', 'add', '--no-track', '-b', branch, worktree, base]);
      const assignment = { repository: repo.id, source: repo.absolute_path, branch, worktree, baseBranch: repo.base_branch, baseCommit };
      assignments.push(assignment);
      newlyCreated.push(assignment);
    }
    return assignments;
  } catch (error) {
    for (const item of newlyCreated.reverse()) {
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
  if (!isWorktreeRegistered(registered, realWorktree)) throw new Error('[cc-nexs] unregistered worktree');
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

export function prepareFeatureForMerge({ repo, worktree, branch, baseBranch, candidateRef = null, preserveConflicts = false }) {
  const realWorktree = realpathSync(worktree);
  const registered = git(repo, ['worktree', 'list', '--porcelain']);
  if (!isWorktreeRegistered(registered, realWorktree)) throw new Error('[cc-nexs] unregistered worktree');
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
    const conflicts = git(worktree, ['diff', '--name-only', '--diff-filter=U', '-z']).split('\0').filter(Boolean);
    if (preserveConflicts && conflicts.length) {
      return { branch, baseBranch, baseCommit: git(repo, ['rev-parse', base]), oldHead, head: oldHead, updated: false, status: 'conflicts', conflicts };
    }
    try { git(worktree, ['merge', '--abort']); } catch {}
    throw new Error(`[cc-nexs] ${branch} conflicts with latest origin/${baseBranch}; resolve before release`);
  }
  const head = git(worktree, ['rev-parse', 'HEAD']);
  if (candidateRef) git(repo, ['update-ref', candidateRef, head]);
  return { branch, baseBranch, baseCommit: git(repo, ['rev-parse', base]), oldHead, head, updated: oldHead !== head };
}

export function assertCandidateContainsRemoteBase({ repo, candidateRef, baseBranch }) {
  const sourceCommit = resolveCandidateCommit({ repo, candidateRef });
  const base = fetchBase(repo, baseBranch);
  const baseCommit = git(repo, ['rev-parse', base]);
  if (!isAncestor(repo, baseCommit, sourceCommit)) {
    throw new Error(`[cc-nexs] BASE_CHANGED: candidate ${sourceCommit} does not contain latest origin/${baseBranch} ${baseCommit}`);
  }
  return { sourceCommit, baseCommit };
}

export function integrateCandidateToTest({
  repo,
  repositoryId,
  candidateRef,
  expectedSourceCommit = null,
  targetBranch,
  requireTargetAncestor = false,
  requireDisjointTargetChanges = false,
  mergeRequest = null,
  previousIntegration = null,
  verifyIntegration = null,
  preserveConflicts = false,
  conflictWorktree = null,
}) {
  assertSegment(repositoryId, 'repository id');
  assertSegment(targetBranch, 'test branch');
  const sourceCommit = resolveCandidateCommit({ repo, candidateRef });
  if (expectedSourceCommit !== null && sourceCommit !== expectedSourceCommit) {
    throw new Error(`[cc-nexs] candidate ref changed during test release for ${repositoryId}`);
  }
  const target = fetchBase(repo, targetBranch);
  const targetBefore = git(repo, ['rev-parse', target]);
  if (requireTargetAncestor && !isAncestor(repo, targetBefore, sourceCommit)) {
    throw new Error(`[cc-nexs] BASE_CHANGED: candidate ${sourceCommit} does not contain current origin/${targetBranch} ${targetBefore}`);
  }
  if (isAncestor(repo, sourceCommit, targetBefore)) {
    return {
      repository: repositoryId,
      sourceCommit,
      targetBranch,
      targetBefore,
      integrationCommit: targetBefore,
      alreadyIntegrated: true,
    };
  }
  let sensitive = [];
  if (requireDisjointTargetChanges && !isAncestor(repo, targetBefore, sourceCommit)) {
    const common = git(repo, ['merge-base', sourceCommit, targetBefore]);
    const paths = (commit) => git(repo, ['diff', '--name-only', '--no-renames', '-z', common, commit]).split('\0').filter(Boolean);
    const candidatePaths = new Set(paths(sourceCommit));
    const targetPaths = paths(targetBefore);
    if (targetPaths.some((path) => candidatePaths.has(path))) {
      throw new Error(`[cc-nexs] BASE_CHANGED: origin/${targetBranch} overlaps candidate paths; resolve and verify the affected changes before release`);
    }
    sensitive = targetPaths.filter(isSensitiveBasePath);
    if (sensitive.length && !verifyIntegration) {
      throw new Error(`[cc-nexs] BASE_CHANGED: origin/${targetBranch} changed shared runtime or contract paths (${sensitive.join(', ')}); sync and re-verify automatically before release`);
    }
  }
  const tempRoot = conflictWorktree ? null : mkdtempSync(join(tmpdir(), `cc-nexs-test-release-${repositoryId}-`));
  const integrationWorktree = conflictWorktree || join(tempRoot, 'worktree');
  mkdirSync(dirname(integrationWorktree), { recursive: true });
  let registered = false;
  let keepWorktree = false;
  try {
    git(repo, ['worktree', 'add', '--detach', integrationWorktree, target]);
    registered = true;
    const identity = resolveGitIdentity(repo);
    try {
      // rerere replays a recorded resolution if the target advances and the merge is retried.
      git(integrationWorktree, [...(preserveConflicts ? ['-c', 'rerere.enabled=true'] : []), 'merge', '--no-ff', '--no-edit', sourceCommit], { env: gitIdentityEnv(identity) });
    } catch {
      const conflicts = git(integrationWorktree, ['diff', '--name-only', '--diff-filter=U', '-z']).split('\0').filter(Boolean);
      if (preserveConflicts && conflicts.length) {
        keepWorktree = true;
        return { repository: repositoryId, sourceCommit, targetBranch, targetBefore, status: 'conflicts', conflicts, worktree: integrationWorktree };
      }
      try { git(integrationWorktree, ['merge', '--abort']); } catch {}
      throw new Error(`[cc-nexs] ${requireDisjointTargetChanges ? 'BASE_CHANGED: ' : ''}candidate ${candidateRef} conflicts with latest origin/${targetBranch}`);
    }
    const integrationCommit = previousIntegration?.merge_request && previousIntegration.source_commit === sourceCommit && previousIntegration.target_before === targetBefore
      ? previousIntegration.integration_commit : git(integrationWorktree, ['rev-parse', 'HEAD']);
    let integrationVerification = null;
    if (sensitive.length) {
      integrationVerification = verifyIntegration({ repository: repositoryId, sourceCommit, targetBefore, integrationCommit, worktree: integrationWorktree, sensitivePaths: sensitive });
      if (integrationVerification?.status !== 'passed'
        || integrationVerification.integrationCommit !== integrationCommit
        || typeof integrationVerification.proof !== 'string' || !integrationVerification.proof.trim()) {
        throw new Error('[cc-nexs] BASE_CHANGED: integration checks did not prove the exact merged candidate; sync and re-verify');
      }
      if (git(integrationWorktree, ['rev-parse', 'HEAD']) !== integrationCommit || git(integrationWorktree, ['status', '--porcelain'])) throw new Error('[cc-nexs] integration verifier modified the merged candidate');
    }
    if (mergeRequest) {
      const sourceBranch = `cc-nexs-mr-${repositoryId}-${integrationCommit}`;
      git(integrationWorktree, ['push', 'origin', `${integrationCommit}:refs/heads/${sourceBranch}`]);
      const receipt = mergeRequest({ repository: repositoryId, sourceBranch, sourceCommit, integrationCommit, targetBranch, targetBefore });
      if (!receipt || !['pending', 'merged'].includes(receipt.status) || typeof receipt.url !== 'string' || !/^https?:\/\//.test(receipt.url)) throw new Error('[cc-nexs] invalid MR receipt');
      const remote = fetchBase(repo, targetBranch);
      const remoteCommit = git(repo, ['rev-parse', remote]);
      const merged = isAncestor(repo, integrationCommit, remoteCommit);
      if (receipt.status === 'merged' && !merged) throw new Error('[cc-nexs] MR receipt has no remote ancestry proof');
      return { repository: repositoryId, sourceCommit, targetBranch, targetBefore, integrationCommit, remoteCommit, pending: !merged, mergeRequest: receipt, integrationVerification };
    }
    try {
      git(integrationWorktree, ['push', 'origin', `${integrationCommit}:refs/heads/${targetBranch}`]);
    } catch (error) {
      const detail = error.stderr?.toString().trim() || error.message;
      const remote = fetchBase(repo, targetBranch);
      if (git(repo, ['rev-parse', remote]) !== targetBefore) throw new Error(`[cc-nexs] origin/${targetBranch} advanced during integration; retry from the new remote tip: ${detail}`);
      throw new Error(`[cc-nexs] PUSH_REJECTED: origin/${targetBranch} did not advance; check branch protection/permissions and configure release.base.driver for MR delivery: ${detail}`);
    }
    const remote = fetchBase(repo, targetBranch);
    const remoteCommit = git(repo, ['rev-parse', remote]);
    if (!isAncestor(repo, sourceCommit, remoteCommit) || !isAncestor(repo, integrationCommit, remoteCommit)) {
      throw new Error(`[cc-nexs] remote test integration proof failed for ${repositoryId}`);
    }
    return {
      repository: repositoryId,
      sourceCommit,
      targetBranch,
      targetBefore,
      integrationCommit,
      remoteCommit,
      alreadyIntegrated: false,
      integrationVerification,
    };
  } finally {
    if (registered && !keepWorktree) {
      try { git(repo, ['worktree', 'remove', '--force', integrationWorktree]); } catch {}
      try { git(repo, ['worktree', 'prune']); } catch {}
    }
    if (tempRoot && !keepWorktree) rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function resolveTestIntegrationConflict({ repo, worktree, targetBranch, sourceCommit, targetBefore }) {
  assertSegment(targetBranch, 'test branch');
  const commonDir = path => realpathSync(git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  if (commonDir(repo) !== commonDir(worktree)) throw new Error('[cc-nexs] conflict worktree belongs to another repository');
  let mergeHead = null;
  try { mergeHead = git(worktree, ['rev-parse', '--verify', 'MERGE_HEAD']); } catch {}
  if (mergeHead) {
    if (mergeHead !== sourceCommit || git(worktree, ['rev-parse', 'HEAD']) !== targetBefore) throw new Error('[cc-nexs] test merge no longer matches recorded source and target');
    const unresolved = git(worktree, ['diff', '--name-only', '--diff-filter=U', '-z']).split('\0').filter(Boolean);
    if (unresolved.length) throw new Error(`[cc-nexs] unresolved test integration files remain: ${unresolved.join(', ')}`);
    // The Developer stages only resolved paths; never sweep unrelated files into the merge.
    const identity = resolveGitIdentity(repo);
    git(worktree, ['-c', 'rerere.enabled=true', 'commit', '--no-edit'], { env: gitIdentityEnv(identity) });
  }
  const integrationCommit = git(worktree, ['rev-parse', 'HEAD']);
  const parents = git(worktree, ['show', '-s', '--format=%P', 'HEAD']).split(' ');
  if (parents.length !== 2 || parents[0] !== targetBefore || parents[1] !== sourceCommit) throw new Error('[cc-nexs] resolved test integration must preserve both recorded parents');
  if (git(worktree, ['status', '--porcelain'])) throw new Error('[cc-nexs] conflict worktree must be clean before push');
  try {
    git(worktree, ['push', 'origin', `${integrationCommit}:refs/heads/${targetBranch}`]);
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    if (git(repo, ['rev-parse', fetchBase(repo, targetBranch)]) !== targetBefore) {
      const advanced = new Error(`[cc-nexs] TARGET_ADVANCED: origin/${targetBranch} moved during conflict resolution; the resolution is recorded for the next integration: ${detail}`);
      advanced.code = 'TARGET_ADVANCED';
      throw advanced;
    }
    throw error;
  }
  const remote = fetchBase(repo, targetBranch);
  const remoteCommit = git(repo, ['rev-parse', remote]);
  if (!isAncestor(repo, integrationCommit, remoteCommit)) throw new Error('[cc-nexs] resolved test integration remote proof failed');
  return { integrationCommit, remoteCommit, targetBranch };
}

function isAncestor(repo, ancestor, descendant) {
  try { git(repo, ['merge-base', '--is-ancestor', ancestor, descendant]); return true; } catch { return false; }
}

// Removes a preserved test-conflict worktree that no active attempt still needs.
export function removeIntegrationWorktree({ repo, worktree, root }) {
  assertWithin(root, worktree);
  if (existsSync(worktree)) {
    try { git(repo, ['worktree', 'remove', '--force', worktree]); } catch {}
    rmSync(worktree, { recursive: true, force: true });
  }
  try { git(repo, ['worktree', 'prune']); } catch {}
}

export function cleanupMergedWorktree({ repo, worktree, branch, baseBranch, candidateRef = null, deleteRemote = false }) {
  if (!existsSync(worktree) && !refExists(repo, `refs/heads/${branch}`)) {
    // base release already removed the worktree; finalize still owns the merged candidate ref.
    if (candidateRef && refExists(repo, candidateRef)) {
      if (!isAncestor(repo, candidateRef, fetchBase(repo, baseBranch))) throw new Error(`[cc-nexs] candidate ref is not merged into ${baseBranch}`);
      git(repo, ['update-ref', '-d', candidateRef]);
    }
    return { removed: worktree, branchDeleted: branch, alreadyClean: true };
  }
  const realWorktree = realpathSync(worktree);
  const registered = git(repo, ['worktree', 'list', '--porcelain']);
  if (!isWorktreeRegistered(registered, realWorktree)) throw new Error('[cc-nexs] refusing cleanup of unregistered worktree');
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
