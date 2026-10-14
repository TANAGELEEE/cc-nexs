import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { recordPublishedFeatureReservation } from './feature-reservation.mjs';
import { gitIdentityEnv, resolveGitIdentity } from './git-identity.mjs';

function git(repo, args, options = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
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
    throw new Error(`[cc-nexs] unsafe reservation worktree path: ${target}`);
  }
  return target;
}

function fetchBase(repo, branch) {
  git(repo, ['fetch', '--prune', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  return git(repo, ['rev-parse', `refs/remotes/origin/${branch}`]);
}

function remoteFeatureDirs(repo, baseCommit) {
  try {
    return git(repo, ['ls-tree', '-d', '--name-only', `${baseCommit}:doc`]).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function allocateId(names) {
  const numeric = names.map((name) => name.match(/^(\d+)\./)?.[1]).filter(Boolean);
  const max = numeric.length ? Math.max(...numeric.map(Number)) : 0;
  const width = Math.max(2, ...numeric.map((value) => value.length));
  return String(max + 1).padStart(width, '0');
}

function readMarker(repo, baseCommit, featureId, featureSlug) {
  try {
    return JSON.parse(git(repo, ['show', `${baseCommit}:doc/${featureId}.${featureSlug}/.cc-nexs-reservation.json`]));
  } catch {
    return null;
  }
}

function locallyReservedId(workspace, featureSlug) {
  const root = join(workspace.projectRoot, '.cc-nexs', 'reservations');
  if (!existsSync(root)) return null;
  for (const name of readdirSync(root).sort().reverse()) {
    if (!name.endsWith('.json')) continue;
    try {
      const value = JSON.parse(readFileSync(join(root, name), 'utf8'));
      if (value.feature_slug === featureSlug && value.remote_commit) return value.feature_id;
    } catch {}
  }
  return null;
}

function writeReservationFiles(worktree, { featureId, featureSlug, description }) {
  const reqDir = join(worktree, 'doc', `${featureId}.${featureSlug}`);
  mkdirSync(reqDir, { recursive: true });
  const marker = {
    schema_version: 1,
    feature_id: featureId,
    feature_slug: featureSlug,
    status: 'RESERVED',
    reserved_at: new Date().toISOString(),
  };
  writeFileSync(join(reqDir, '.cc-nexs-reservation.json'), `${JSON.stringify(marker, null, 2)}\n`);
  writeFileSync(join(reqDir, 'README.md'), [
    `# ${featureId} ${featureSlug}`,
    '',
    '> Feature number reserved by cc-nexs. Final requirements and delivery records are committed in phase two.',
    '',
    ...(description ? [`Request: ${description}`, ''] : []),
  ].join('\n'));
}

export function publishDocsReservation(workspace, {
  featureId = null,
  featureSlug,
  description = '',
  maxAttempts = 5,
} = {}) {
  assertSegment(featureSlug, 'feature slug');
  if (featureId !== null) assertSegment(featureId, 'feature id');
  const docs = workspace.repositories.find((repo) => repo.id === workspace.docs_repository);
  if (!docs) throw new Error('[cc-nexs] docs repository is not configured');
  const baseBranch = assertSegment(docs.base_branch, 'docs base branch');
  const localResumeId = featureId === null ? locallyReservedId(workspace, featureSlug) : null;
  if (localResumeId) featureId = localResumeId;
  const explicitId = featureId !== null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const baseCommit = fetchBase(docs.absolute_path, baseBranch);
    const names = remoteFeatureDirs(docs.absolute_path, baseCommit);
    const chosenId = featureId || allocateId(names);
    const sameId = names.find((name) => name.startsWith(`${chosenId}.`));
    if (sameId) {
      const marker = readMarker(docs.absolute_path, baseCommit, chosenId, featureSlug);
      if (sameId === `${chosenId}.${featureSlug}` && marker?.feature_slug === featureSlug) {
        recordPublishedFeatureReservation(workspace, { featureId: chosenId, featureSlug, commit: baseCommit, baseBranch });
        return { featureId: chosenId, featureSlug, commit: baseCommit, baseBranch, alreadyReserved: true };
      }
      if (explicitId) throw new Error(`[cc-nexs] feature id already exists on origin/${baseBranch}: ${sameId}`);
      featureId = null;
      continue;
    }

    const identity = resolveGitIdentity(docs.absolute_path);
    const temp = assertWithin(workspace.worktree_root, join(workspace.worktree_root, '.reservations', randomUUID()));
    mkdirSync(dirname(temp), { recursive: true });
    let registered = false;
    try {
      git(docs.absolute_path, ['worktree', 'add', '--detach', temp, baseCommit]);
      registered = true;
      writeReservationFiles(temp, { featureId: chosenId, featureSlug, description });
      git(temp, ['add', '--', `doc/${chosenId}.${featureSlug}`]);
      git(temp, ['commit', '-m', `docs: reserve feature ${chosenId} ${featureSlug}`], {
        env: gitIdentityEnv(identity),
      });
      const commit = git(temp, ['rev-parse', 'HEAD']);
      try {
        git(temp, ['push', 'origin', `${commit}:refs/heads/${baseBranch}`]);
      } catch {
        const current = fetchBase(docs.absolute_path, baseBranch);
        if (!explicitId && current !== baseCommit && attempt < maxAttempts) continue;
        throw new Error(`[cc-nexs] cannot publish docs reservation to origin/${baseBranch}; the branch may be protected or permission was denied`);
      }
      recordPublishedFeatureReservation(workspace, { featureId: chosenId, featureSlug, commit, baseBranch });
      return { featureId: chosenId, featureSlug, commit, baseBranch, alreadyReserved: false };
    } finally {
      if (registered) {
        try { git(docs.absolute_path, ['worktree', 'remove', '--force', temp]); } catch {}
        try { git(docs.absolute_path, ['worktree', 'prune']); } catch {}
      } else if (existsSync(temp)) {
        rmSync(temp, { recursive: true, force: true });
      }
    }
  }
  throw new Error(`[cc-nexs] could not reserve a feature id after ${maxAttempts} concurrent attempts`);
}
