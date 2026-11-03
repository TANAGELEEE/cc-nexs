import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveCandidateContext } from './candidate-context.mjs';
import { prepareFeatureForMerge } from './git-custodian.mjs';
import { gitIdentityEnv, resolveGitIdentity } from './git-identity.mjs';
import { acquireTestReleaseLock } from './test-release.mjs';
import { appendProgressEvent, readProgressV2, recordRepositoryCandidatePrepared } from './progress-v2.mjs';

const git = (cwd, args, env = process.env) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }).trim();

// Completes a sync-base merge that stopped on conflicts after the Developer
// resolved the files. Only the reported conflicts and explicitly named paths
// are staged; the upstream changes the merge already staged are preserved.
export function finishBaseSync({ cwd = process.cwd(), featureId, progressPath = null, paths = [] } = {}) {
  const context = resolveCandidateContext({ cwd, featureId, progressPath, includeDocs: false });
  const unlock = acquireTestReleaseLock(context.progressFile);
  try {
    const progress = readProgressV2(context.progressFile);
    const expectedState = progress.mode === 'hotfix' ? 'HOTFIX_FIXING' : 'IMPLEMENTING';
    if (progress.state !== expectedState) throw new Error(`[cc-nexs] finish-base-sync requires ${expectedState} after a conflicting sync-base, found ${progress.state}`);
    const synced = progress.events.findLast((event) => event.type === 'base.synced');
    const pending = (synced?.data?.results || []).filter((item) => item.status === 'conflicts');
    if (!pending.length) throw new Error('[cc-nexs] no conflicting sync-base merge is waiting to be finished');
    const extra = parseExtraPaths(paths, pending.map((item) => item.repository));
    const results = [];
    for (const item of pending) {
      const target = context.repositories.find((candidate) => candidate.id === item.repository);
      if (!target) throw new Error(`[cc-nexs] synced repository ${item.repository} has no candidate assignment`);
      const worktree = resolve(context.workspaceRoot, target.assignment.worktree);
      const candidateRef = target.assignment.candidate.ref;
      let mergeHead = null;
      try { mergeHead = git(worktree, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']); } catch {}
      if (!mergeHead) {
        const head = git(worktree, ['rev-parse', 'HEAD']);
        const parents = git(worktree, ['show', '-s', '--format=%P', 'HEAD']).split(' ');
        if (parents[0] === item.oldHead && parents[1] === item.baseCommit && git(target.repository.absolute_path, ['rev-parse', candidateRef]) === head) {
          results.push({ repository: item.repository, head, alreadyFinished: true });
          continue;
        }
        throw new Error(`[cc-nexs] ${item.repository} has no pending sync merge to finish`);
      }
      if (mergeHead !== item.baseCommit || git(worktree, ['rev-parse', 'HEAD']) !== item.oldHead) {
        throw new Error(`[cc-nexs] ${item.repository} merge no longer matches the recorded sync of ${item.baseCommit}`);
      }
      const staged = [...new Set([...item.conflicts, ...(extra.get(item.repository) || [])])];
      // Staging clears the unmerged state even with markers left, so check content first.
      const unresolved = staged.filter((path) => hasConflictMarkers(join(worktree, path)));
      if (unresolved.length) throw new Error(`[cc-nexs] unresolved conflicts remain in ${item.repository}: ${unresolved.join(', ')}`);
      git(worktree, ['add', '--', ...staged]);
      unresolved.push(...git(worktree, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean));
      if (unresolved.length) throw new Error(`[cc-nexs] unresolved conflicts remain in ${item.repository}: ${unresolved.join(', ')}`);
      const unstaged = [
        ...git(worktree, ['diff', '--name-only']).split('\n'),
        ...git(worktree, ['ls-files', '--others', '--exclude-standard']).split('\n'),
      ].filter(Boolean);
      if (unstaged.length) throw new Error(`[cc-nexs] ${item.repository} has changes outside the resolution (${unstaged.join(', ')}); name them with --path ${item.repository}:<path> or revert them`);
      git(worktree, ['commit', '--no-edit'], gitIdentityEnv(resolveGitIdentity(target.repository.absolute_path)));
      const head = git(worktree, ['rev-parse', 'HEAD']);
      const parents = git(worktree, ['show', '-s', '--format=%P', 'HEAD']).split(' ');
      if (parents.length !== 2 || parents[0] !== item.oldHead || parents[1] !== item.baseCommit) throw new Error('[cc-nexs] finished sync merge must keep the candidate and base as parents');
      git(target.repository.absolute_path, ['update-ref', candidateRef, head]);
      recordRepositoryCandidatePrepared(context.progressFile, item.repository, {
        candidateRef,
        staged: [...new Set([...(target.assignment.candidate.paths || []), ...staged])],
      });
      results.push({ repository: item.repository, head, resolved: staged });
    }
    return { kind: 'base-sync-finished', state: readProgressV2(context.progressFile).state, results, progressFile: context.progressFile };
  } finally { unlock(); }
}

function hasConflictMarkers(file) {
  if (!existsSync(file)) return false;
  const bytes = readFileSync(file);
  if (bytes.includes(0)) return false;
  return /^(<{7}|>{7})( |$)/m.test(bytes.toString('utf8'));
}

function parseExtraPaths(paths, repositories) {
  const extra = new Map();
  for (const value of paths) {
    const separator = value.indexOf(':');
    const qualified = separator > 0 && repositories.includes(value.slice(0, separator));
    if (!qualified && repositories.length !== 1) throw new Error(`[cc-nexs] --path must name the repository as <repo>:<path> when several repositories are syncing: ${value}`);
    const repository = qualified ? value.slice(0, separator) : repositories[0];
    const path = qualified ? value.slice(separator + 1) : value;
    if (!path || path.startsWith('/') || path.split(/[\\/]/).includes('..')) throw new Error(`[cc-nexs] unsafe sync path: ${value}`);
    extra.set(repository, [...(extra.get(repository) || []), path]);
  }
  return extra;
}

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
