// Tasks run on several machines; their progress lives in each machine's docs worktree
// until the final docs candidate. share-progress publishes a snapshot of one task's
// progress.json to a dedicated branch of the docs repository (one file per task),
// written with Git plumbing so no worktree, feature branch, or candidate is touched.
// stats --all --remote reads every snapshot on that branch.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { findWorkspaceRoot, loadCandidateConfig } from './candidate-context.mjs';
import { loadWorkspaceConfig } from './config-loader.mjs';
import { gitIdentityEnv, resolveGitIdentity } from './git-identity.mjs';
import { readProgressV2 } from './progress-v2.mjs';

const DEFAULT_BRANCH = 'cc-nexs/progress';
const PUSH_RETRIES = 3;

function git(repo, args, { env = process.env, input } = {}) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] }).trim();
}

function docsRepository(root) {
  const workspace = loadWorkspaceConfig({ projectRoot: root });
  const docs = workspace.repositories.find((repository) => repository.id === workspace.docs_repository);
  if (!docs) throw new Error('[cc-nexs] sharing progress needs a configured docs_repository');
  return docs.absolute_path;
}

export function progressBranch(config) {
  return config.mergedWorkflow?.progress_branch || DEFAULT_BRANCH;
}

function fetchBranch(repo, branch) {
  try {
    git(repo, ['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    return git(repo, ['rev-parse', `refs/remotes/origin/${branch}`]);
  } catch { return null; }
}

function snapshotName(featureId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(featureId))) throw new Error(`[cc-nexs] invalid task id: ${featureId}`);
  return `${featureId}.json`;
}

export function shareProgress({ cwd = process.cwd(), featureId, progressPath = null } = {}) {
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const root = findWorkspaceRoot(cwd, progressFile);
  const repo = docsRepository(root);
  const branch = progressBranch(loadCandidateConfig(root));
  const progress = readProgressV2(progressFile);
  const name = snapshotName(progress.feature.id);
  const blob = git(repo, ['hash-object', '-w', '--stdin'], { input: readFileSync(progressFile, 'utf8') });
  const identity = gitIdentityEnv(resolveGitIdentity(repo));
  for (let attempt = 1; ; attempt += 1) {
    const base = fetchBranch(repo, branch);
    if (base && git(repo, ['ls-tree', base, '--', name]).split(/\s+/)[2] === blob) {
      return { kind: 'progress-share', feature: progress.feature, branch, state: progress.state, commit: base, unchanged: true };
    }
    const scratch = mkdtempSync(join(tmpdir(), 'cc-nexs-progress-share-'));
    try {
      const env = { ...identity, GIT_INDEX_FILE: join(scratch, 'index') };
      if (base) git(repo, ['read-tree', base], { env });
      git(repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},${name}`], { env });
      const tree = git(repo, ['write-tree'], { env });
      const commit = git(repo, ['commit-tree', tree, ...(base ? ['-p', base] : []), '-m', `progress: ${progress.feature.id} ${progress.state} (${hostname()})`], { env });
      try {
        git(repo, ['push', '--quiet', 'origin', `${commit}:refs/heads/${branch}`]);
        return { kind: 'progress-share', feature: progress.feature, branch, state: progress.state, commit, unchanged: false };
      } catch (error) {
        if (attempt >= PUSH_RETRIES) throw new Error(`[cc-nexs] could not push ${branch}: ${error.stderr?.toString().trim() || error.message}`);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

// Every task snapshot on the shared branch, for workspace stats across machines.
export function remoteProgressSnapshots(root) {
  const repo = docsRepository(root);
  const tip = fetchBranch(repo, progressBranch(loadCandidateConfig(root)));
  if (!tip) return [];
  const snapshots = [];
  for (const line of git(repo, ['ls-tree', tip]).split('\n').filter(Boolean)) {
    const [, type, sha, name] = line.split(/\s+/);
    if (type !== 'blob' || !name.endsWith('.json')) continue;
    try { snapshots.push(JSON.parse(git(repo, ['cat-file', 'blob', sha]))); } catch { /* not a progress snapshot */ }
  }
  return snapshots;
}
