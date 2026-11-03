import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertCandidateExcludesTestHistory,
  assertDedicatedTargetFree,
  checkBaseReadiness,
  cleanupMergedWorktree,
  commitCandidate,
  createWorkspaceWorktrees,
  finalizeMergedWorktree,
  classifyMergedWork,
  integrateCandidateToTest,
  isSensitiveBasePath,
  isWorktreeRegistered,
  prepareFeatureForMerge,
  promoteCandidateViaMergeRequest,
  proveCandidateMerge,
  resolveDeployedRevision,
} from './git-custodian.mjs';
import { createProgressV2, readProgressV2, recordRepositoryAssignments, writeProgressV2 } from './progress-v2.mjs';

test('sensitive base paths cover dependencies, contracts and runtime configuration', () => {
  for (const path of ['package.json', 'web/pnpm-lock.yaml', 'go.mod', 'api/dto/user.ts', 'db/migrations/001.sql', 'config/auth.yml', 'Dockerfile', '.github/workflows/build.yml']) {
    assert.equal(isSensitiveBasePath(path), true, path);
  }
  for (const path of ['README.md', 'docs/guide.md', 'src/button.ts', 'unrelated.txt']) {
    assert.equal(isSensitiveBasePath(path), false, path);
  }
});

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function configure(repo) {
  git(repo, ['config', 'user.name', 'Example User']);
  git(repo, ['config', 'user.email', 'example@example.com']);
}

function commitIdentity(repo, commit = 'HEAD') {
  return git(repo, ['show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce', commit]).split('\0');
}

function withToolIdentity(callback) {
  const keys = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: 'Tool Agent',
    GIT_AUTHOR_EMAIL: 'tool-agent@example.com',
    GIT_COMMITTER_NAME: 'Tool Agent',
    GIT_COMMITTER_EMAIL: 'tool-agent@example.com',
  });
  try {
    return callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('custodian starts from latest remote base, avoids false upstream arrows, refreshes, and cleans', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-git-'));
  const origin = join(root, 'origin.git');
  const repo = join(root, 'docs');
  const updater = join(root, 'updater');
  mkdirSync(origin);
  git(origin, ['init', '--bare']);
  git(root, ['clone', origin, repo]);
  configure(repo);
  git(repo, ['checkout', '-b', 'master']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  git(repo, ['push', '-u', 'origin', 'master']);
  git(repo, ['checkout', '-b', 'test']);
  writeFileSync(join(repo, 'test-only.md'), 'must not leak\n');
  git(repo, ['add', 'test-only.md']);
  git(repo, ['commit', '-m', 'test only']);
  git(repo, ['push', '-u', 'origin', 'test']);

  mkdirSync(join(root, '.cc-nexs', 'reservations'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'reservations', '01.json'), JSON.stringify({
    feature_id: '01', feature_slug: 'demo', reserved_at: new Date().toISOString(),
  }));

  const workspace = {
    projectRoot: root,
    worktree_root: join(root, '.worktrees'),
    docs_repository: 'docs',
    repositories: [{ id: 'docs', absolute_path: repo, base_branch: 'master' }],
  };
  try {
    const [item] = createWorkspaceWorktrees(workspace, { featureId: '01', featureSlug: 'demo' });
    assert.equal(git(item.worktree, ['rev-parse', 'HEAD']), git(repo, ['rev-parse', 'origin/master']));
    assert.equal(git(item.worktree, ['ls-files', 'test-only.md']), '');
    assert.throws(() => git(item.worktree, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']));

    const progressFile = join(item.worktree, 'progress.json');
    writeProgressV2(progressFile, createProgressV2({ featureId: '01', featureSlug: 'demo', preset: 'preset-standard' }));
    recordRepositoryAssignments(progressFile, [item], { workspaceRoot: root });
    writeFileSync(join(item.worktree, 'feature.md'), 'candidate\n');
    const candidate = withToolIdentity(() => commitCandidate({
      repositoryId: 'docs', repo, worktree: item.worktree, branch: item.branch,
      featureKey: '01-demo', paths: ['feature.md', 'progress.json'], message: 'docs: candidate', progressFile,
    }));
    assert.deepEqual(commitIdentity(repo, candidate.commit), [
      'Example User', 'example@example.com', 'Example User', 'example@example.com',
    ]);
    assert.equal(git(item.worktree, ['status', '--porcelain']), '');
    assert.equal(readProgressV2(progressFile).repositories.docs.candidate.commit, null);
    assert.equal(git(repo, ['rev-parse', candidate.candidateRef]), candidate.commit);

    git(root, ['clone', origin, updater]);
    configure(updater);
    git(updater, ['checkout', 'master']);
    writeFileSync(join(updater, 'upstream.md'), 'new base\n');
    git(updater, ['add', 'upstream.md']);
    git(updater, ['commit', '-m', 'advance master']);
    git(updater, ['push', 'origin', 'master']);
    const prepared = withToolIdentity(() => prepareFeatureForMerge({
      repo, worktree: item.worktree, branch: item.branch, baseBranch: 'master', candidateRef: candidate.candidateRef,
    }));
    assert.equal(prepared.updated, true);
    assert.deepEqual(commitIdentity(repo, prepared.head), [
      'Example User', 'example@example.com', 'Example User', 'example@example.com',
    ]);
    assert.equal(git(item.worktree, ['show', 'HEAD:upstream.md']), 'new base');
    assert.throws(() => git(item.worktree, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']));

    const featureBeforeTestRelease = git(item.worktree, ['rev-parse', 'HEAD']);
    assert.throws(() => integrateCandidateToTest({
      repo,
      repositoryId: 'docs',
      candidateRef: candidate.candidateRef,
      expectedSourceCommit: '0000000000000000000000000000000000000000',
      targetBranch: 'test',
    }), /candidate ref changed during test release/);
    assert.throws(() => integrateCandidateToTest({
      repo,
      repositoryId: 'docs',
      candidateRef: candidate.candidateRef,
      expectedSourceCommit: git(repo, ['rev-parse', candidate.candidateRef]),
      targetBranch: 'test',
      requireTargetAncestor: true,
    }), /BASE_CHANGED: candidate .* does not contain current origin\/test/);
    const integrated = withToolIdentity(() => integrateCandidateToTest({
      repo,
      repositoryId: 'docs',
      candidateRef: candidate.candidateRef,
      expectedSourceCommit: git(repo, ['rev-parse', candidate.candidateRef]),
      targetBranch: 'test',
    }));
    assert.equal(integrated.alreadyIntegrated, false);
    assert.equal(git(item.worktree, ['rev-parse', 'HEAD']), featureBeforeTestRelease);
    assert.equal(git(repo, ['show', 'origin/test:feature.md']), 'candidate');
    assert.equal(git(repo, ['show', 'origin/test:test-only.md']), 'must not leak');

    const repeatedIntegration = integrateCandidateToTest({
      repo,
      repositoryId: 'docs',
      candidateRef: candidate.candidateRef,
      targetBranch: 'test',
    });
    assert.equal(repeatedIntegration.alreadyIntegrated, true);
    assert.throws(() => integrateCandidateToTest({
      repo,
      repositoryId: 'docs',
      candidateRef: candidate.candidateRef,
      targetBranch: 'test',
      requireTargetAncestor: true,
    }), /BASE_CHANGED: candidate .* does not contain current origin\/test/);

    git(item.worktree, ['push', 'origin', `${item.branch}:${item.branch}`]);
    git(item.worktree, ['push', 'origin', `${item.branch}:master`]);
    const finalized = finalizeMergedWorktree({ repo, worktree: item.worktree, branch: item.branch, baseBranch: 'master', candidateRef: candidate.candidateRef });
    assert.equal(finalized.remoteBranchDeleted, true);
    assert.throws(() => git(repo, ['show-ref', '--verify', `refs/heads/${item.branch}`]));
    assert.throws(() => git(repo, ['show-ref', '--verify', candidate.candidateRef]));
    assert.equal(git(repo, ['ls-remote', '--heads', 'origin', `refs/heads/${item.branch}`]), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('worktree registration matches Windows Git paths without weakening exact identity', () => {
  const identity = (value) => value;
  const porcelain = 'worktree D:/workspaces/code\r\nHEAD abc\r\n\r\nworktree D:/workspaces/.worktrees/07-x/code\r\nbranch refs/heads/feature/07-x\r\n';
  const win32 = { platform: 'win32', realpath: identity };
  assert.equal(isWorktreeRegistered(porcelain, 'D:\\Workspaces\\.worktrees\\07-x\\code', win32), true);
  assert.equal(isWorktreeRegistered(porcelain, 'D:\\workspaces\\.worktrees\\07-x\\code2', win32), false);
  assert.equal(isWorktreeRegistered(porcelain, 'D:\\workspaces\\.worktrees\\07-x', win32), false);
  const unc = 'worktree //server/share/中文 路径/code\n';
  assert.equal(isWorktreeRegistered(unc, '\\\\server\\share\\中文 路径\\code', win32), true);
  const posix = { platform: 'linux', realpath: identity };
  assert.equal(isWorktreeRegistered('worktree /w/.worktrees/07-x/code\n', '/w/.worktrees/07-x/code', posix), true);
  assert.equal(isWorktreeRegistered('worktree /w/.worktrees/07-x/code\n', '/w/.worktrees/07-X/code', posix), false);
});

test('finalize removes a merged candidate ref after base release already removed the worktree', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-finalize-ref-'));
  const origin = join(root, 'origin.git');
  const repo = join(root, 'code');
  const worktree = join(root, '.worktrees', '07-x', 'code');
  mkdirSync(origin);
  git(origin, ['init', '--bare']);
  git(root, ['clone', origin, repo]);
  configure(repo);
  git(repo, ['checkout', '-b', 'master']);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', 'base.txt']);
  git(repo, ['commit', '-m', 'base']);
  git(repo, ['push', '-u', 'origin', 'master']);
  try {
    git(repo, ['worktree', 'add', '-b', 'feature/07-x', worktree, 'origin/master']);
    writeFileSync(join(worktree, 'feature.txt'), 'feature\n');
    git(worktree, ['add', 'feature.txt']);
    git(worktree, ['commit', '-m', 'feature']);
    const candidateRef = 'refs/cc-nexs/candidates/07-x/code';
    git(repo, ['update-ref', candidateRef, git(worktree, ['rev-parse', 'HEAD'])]);
    git(worktree, ['push', 'origin', 'HEAD:master']);
    // base release keeps the ref so a resumed release can still resolve the candidate.
    cleanupMergedWorktree({ repo, worktree, branch: 'feature/07-x', baseBranch: 'master', candidateRef: null });
    assert.equal(git(repo, ['rev-parse', candidateRef]).length, 40);

    const unmergedRef = 'refs/cc-nexs/candidates/08-y/code';
    git(repo, ['update-ref', unmergedRef, git(repo, ['commit-tree', '-p', 'origin/master', '-m', 'unmerged', 'origin/master^{tree}'])]);
    assert.throws(() => finalizeMergedWorktree({ repo, worktree: join(root, '.worktrees', '08-y', 'code'), branch: 'feature/08-y', baseBranch: 'master', candidateRef: unmergedRef }), /not merged into master/);
    assert.equal(git(repo, ['rev-parse', unmergedRef]).length, 40);

    const finalized = finalizeMergedWorktree({ repo, worktree, branch: 'feature/07-x', baseBranch: 'master', candidateRef });
    assert.equal(finalized.alreadyClean, true);
    assert.throws(() => git(repo, ['show-ref', '--verify', candidateRef]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createWorkspaceWorktrees rejects when no reservation exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-git-'));
  const origin = join(root, 'origin.git');
  const repo = join(root, 'docs');
  mkdirSync(origin);
  git(origin, ['init', '--bare']);
  git(root, ['clone', origin, repo]);
  configure(repo);
  git(repo, ['checkout', '-b', 'master']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  git(repo, ['push', '-u', 'origin', 'master']);

  const workspace = {
    projectRoot: root,
    worktree_root: join(root, '.worktrees'),
    docs_repository: 'docs',
    repositories: [{ id: 'docs', absolute_path: repo, base_branch: 'master' }],
  };
  try {
    assert.throws(
      () => createWorkspaceWorktrees(workspace, { featureId: '99', featureSlug: 'no-reservation' }),
      /no reservation for feature 99/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createWorkspaceWorktrees rejects when slug does not match reservation', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-git-'));
  const origin = join(root, 'origin.git');
  const repo = join(root, 'docs');
  mkdirSync(origin);
  git(origin, ['init', '--bare']);
  git(root, ['clone', origin, repo]);
  configure(repo);
  git(repo, ['checkout', '-b', 'master']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  git(repo, ['push', '-u', 'origin', 'master']);

  mkdirSync(join(root, '.cc-nexs', 'reservations'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'reservations', '42.json'), JSON.stringify({
    feature_id: '42', feature_slug: 'correct-slug', reserved_at: new Date().toISOString(),
  }));

  const workspace = {
    projectRoot: root,
    worktree_root: join(root, '.worktrees'),
    docs_repository: 'docs',
    repositories: [{ id: 'docs', absolute_path: repo, base_branch: 'master' }],
  };
  try {
    assert.throws(
      () => createWorkspaceWorktrees(workspace, { featureId: '42', featureSlug: 'wrong-slug' }),
      /feature 42 is reserved for slug "correct-slug", not "wrong-slug"/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createWorkspaceWorktrees succeeds when slug matches reservation', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-git-'));
  const origin = join(root, 'origin.git');
  const repo = join(root, 'docs');
  mkdirSync(origin);
  git(origin, ['init', '--bare']);
  git(root, ['clone', origin, repo]);
  configure(repo);
  git(repo, ['checkout', '-b', 'master']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  git(repo, ['push', '-u', 'origin', 'master']);

  mkdirSync(join(root, '.cc-nexs', 'reservations'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'reservations', '50.json'), JSON.stringify({
    feature_id: '50', feature_slug: 'my-feature', reserved_at: new Date().toISOString(),
  }));

  const workspace = {
    projectRoot: root,
    worktree_root: join(root, '.worktrees'),
    docs_repository: 'docs',
    repositories: [{ id: 'docs', absolute_path: repo, base_branch: 'master' }],
  };
  try {
    const [item] = createWorkspaceWorktrees(workspace, { featureId: '50', featureSlug: 'my-feature' });
    assert.equal(item.branch, 'feature/50-my-feature');
    assert.equal(item.repository, 'docs');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('automatic base sync preserves conflicts on the development branch without moving the candidate', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-conflict-'));
  try {
    const repo = join(root, 'repo');
    const worktree = join(root, 'feature');
    mkdirSync(repo);
    git(repo, ['init', '-b', 'main']);
    configure(repo);
    writeFileSync(join(repo, 'file.txt'), 'base\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'base']);
    git(root, ['init', '--bare', join(root, 'remote.git')]);
    git(repo, ['remote', 'add', 'origin', join(root, 'remote.git')]);
    git(repo, ['push', 'origin', 'main']);
    git(repo, ['worktree', 'add', '-b', 'feature/test', worktree]);
    writeFileSync(join(worktree, 'file.txt'), 'feature\n');
    git(worktree, ['add', '.']);
    git(worktree, ['commit', '-m', 'feature']);
    const candidate = git(worktree, ['rev-parse', 'HEAD']);
    const candidateRef = 'refs/cc-nexs/candidates/test';
    git(repo, ['update-ref', candidateRef, candidate]);
    writeFileSync(join(repo, 'file.txt'), 'upstream\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'upstream']);
    git(repo, ['push', 'origin', 'main']);
    const result = prepareFeatureForMerge({ repo, worktree, branch: 'feature/test', baseBranch: 'main', candidateRef, preserveConflicts: true });
    assert.equal(result.status, 'conflicts');
    assert.deepEqual(result.conflicts, ['file.txt']);
    assert.equal(git(repo, ['rev-parse', candidateRef]), candidate);
    assert.equal(git(worktree, ['rev-parse', 'MERGE_HEAD']), result.baseCommit);
    writeFileSync(join(worktree, 'file.txt'), 'feature and upstream\n');
    git(worktree, ['add', 'file.txt']);
    assert.equal(git(worktree, ['diff', '--name-only', '--diff-filter=U']), '');
    git(worktree, ['commit', '--no-edit']);
    git(worktree, ['merge-base', '--is-ancestor', result.baseCommit, 'HEAD']);
    git(worktree, ['merge-base', '--is-ancestor', candidate, 'HEAD']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function mrFixture(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const origin = join(root, 'remote.git');
  const repo = join(root, 'repo');
  git(root, ['init', '--bare', origin]); git(root, ['clone', origin, repo]); configure(repo);
  git(repo, ['checkout', '-b', 'main']);
  writeFileSync(join(repo, 'base.txt'), 'base'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'base']); git(repo, ['push', 'origin', 'main']);
  git(repo, ['checkout', '-b', 'feature/07-demo']);
  writeFileSync(join(repo, 'change.txt'), 'feature'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'feature']);
  const source = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['update-ref', 'refs/cc-nexs/candidates/07-demo/api', source]);
  const options = { repo, repositoryId: 'api', branch: 'feature/07-demo', candidateRef: 'refs/cc-nexs/candidates/07-demo/api', targetBranch: 'main' };
  const pushingDriver = (url = 'https://git.example/mr/7') => (payload) => {
    git(repo, ['push', 'origin', `${payload.sourceCommit}:refs/heads/${payload.sourceBranch}`]);
    return { status: 'pending', url };
  };
  // Stands in for the server merge button: a merge commit whose second parent is the MR head.
  const serverMerge = (head) => {
    const server = join(root, `server-${Math.random().toString(16).slice(2)}`);
    git(root, ['clone', origin, server]); configure(server);
    git(server, ['checkout', 'main']);
    git(server, ['merge', '--no-ff', '--no-edit', head]);
    git(server, ['push', 'origin', 'main']);
    return git(server, ['rev-parse', 'HEAD']);
  };
  return { root, origin, repo, source, options, pushingDriver, serverMerge };
}

test('MR delivery uses the feature branch at the exact candidate and creates no synthetic merge', () => {
  const fixture = mrFixture('cc-nexs-mr-feature-');
  try {
    const { repo, source, options } = fixture;
    const base = git(repo, ['rev-parse', 'origin/main']);
    let payload;
    const result = promoteCandidateViaMergeRequest({ ...options, mergeRequest: (request) => { payload = request; return fixture.pushingDriver()(request); } });
    assert.deepEqual(Object.keys(payload).sort(), ['repository', 'sourceBranch', 'sourceCommit', 'targetBefore', 'targetBranch']);
    assert.equal(payload.sourceBranch, 'feature/07-demo');
    assert.equal(payload.sourceCommit, source);
    assert.equal(result.pending, true);
    assert.equal(git(repo, ['ls-remote', '--heads', 'origin', 'refs/heads/feature/07-demo']).split(/\s+/)[0], source);
    assert.equal(git(repo, ['rev-parse', 'origin/main']), base);
    assert.equal(git(repo, ['ls-remote', '--heads', 'origin', 'cc-nexs-mr-*']), '');
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('MR delivery rejects an unpushed or moved source and receipt text without remote ancestry', () => {
  const fixture = mrFixture('cc-nexs-mr-drift-');
  try {
    const { repo, options } = fixture;
    assert.throws(() => promoteCandidateViaMergeRequest({ ...options, mergeRequest: () => ({ status: 'pending', url: 'https://git.example/mr/1' }) }), /MR_SOURCE_DRIFT: origin\/feature\/07-demo is absent/);
    assert.throws(() => promoteCandidateViaMergeRequest({ ...options, mergeRequest: () => ({ status: 'merged', url: 'https://git.example/mr/1' }) }), /no remote ancestry proof/);
    writeFileSync(join(repo, 'extra.txt'), 'unapproved'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'extra']);
    git(repo, ['push', 'origin', 'HEAD:refs/heads/feature/07-demo']);
    assert.throws(() => promoteCandidateViaMergeRequest({ ...options, mergeRequest: () => ({ status: 'pending', url: 'https://git.example/mr/1' }) }), /MR_SOURCE_DRIFT: origin\/feature\/07-demo is [0-9a-f]{40}, expected approved candidate/);
    assert.throws(() => git(repo, ['show', 'origin/main:change.txt']));
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('merged MR is proven by a server merge commit or fast-forward of the exact candidate', () => {
  const fixture = mrFixture('cc-nexs-mr-merged-');
  try {
    const { repo, source, options } = fixture;
    promoteCandidateViaMergeRequest({ ...options, mergeRequest: fixture.pushingDriver() });
    const mergeCommit = fixture.serverMerge(source);
    const merged = promoteCandidateViaMergeRequest({ ...options, mergeRequest: fixture.pushingDriver() });
    assert.equal(merged.pending, false);
    assert.equal(merged.relation, 'merge');
    assert.equal(merged.mergeCommit, mergeCommit);
    assert.deepEqual(proveCandidateMerge({ repo, remoteCommit: source, sourceCommit: source }), { mergeCommit: source, relation: 'fast-forward' });
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('a merged MR head that moved beyond the approved candidate is refused', () => {
  const fixture = mrFixture('cc-nexs-mr-moved-');
  try {
    const { repo, options } = fixture;
    writeFileSync(join(repo, 'extra.txt'), 'unapproved'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'extra']);
    git(repo, ['push', 'origin', 'HEAD:refs/heads/feature/07-demo']);
    fixture.serverMerge(git(repo, ['rev-parse', 'HEAD']));
    assert.throws(() => promoteCandidateViaMergeRequest({ ...options, mergeRequest: fixture.pushingDriver() }), /MR_SOURCE_DRIFT: .* only through other commits/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('MR delivery keeps the overlap and sensitive-path guards and binds integration checks to the merged tree', () => {
  const fixture = mrFixture('cc-nexs-mr-guards-');
  try {
    const { root, origin, repo, options } = fixture;
    const other = join(root, 'other');
    git(root, ['clone', origin, other]); configure(other); git(other, ['checkout', 'main']);
    writeFileSync(join(other, 'package.json'), '{"name":"fixture"}'); git(other, ['add', '.']); git(other, ['commit', '-m', 'dependency']); git(other, ['push', 'origin', 'main']);
    let calls = 0;
    const driver = (request) => { calls += 1; return fixture.pushingDriver()(request); };
    assert.throws(() => promoteCandidateViaMergeRequest({ ...options, mergeRequest: driver }), /BASE_CHANGED: .*shared runtime or contract paths \(package\.json\)/);
    assert.equal(calls, 0);
    const result = promoteCandidateViaMergeRequest({ ...options, mergeRequest: driver, verifyIntegration: (payload) => {
      assert.equal(git(payload.worktree, ['show', 'HEAD:change.txt']), 'feature');
      return { status: 'passed', integrationCommit: payload.integrationCommit, proof: 'merged tree checks passed' };
    } });
    assert.equal(result.integrationVerification.status, 'passed');
    assert.match(result.integrationVerification.integrationTree, /^[0-9a-f]{40}$/);
    assert.equal(git(repo, ['worktree', 'list', '--porcelain']).split('\n').filter((line) => line.startsWith('worktree ')).length, 1);
    writeFileSync(join(other, 'change.txt'), 'upstream'); git(other, ['add', '.']); git(other, ['commit', '-m', 'overlap']); git(other, ['push', 'origin', 'main']);
    assert.throws(() => promoteCandidateViaMergeRequest({ ...options, mergeRequest: driver, verifyIntegration: () => ({}) }), /BASE_CHANGED: origin\/main overlaps candidate paths/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('base readiness reports drift before Gateway B without mutating refs', () => {
  const fixture = mrFixture('cc-nexs-readiness-');
  try {
    const { root, origin, repo, source } = fixture;
    const check = (extra = {}) => checkBaseReadiness({ repo, repositoryId: 'api', sourceCommit: source, targetBranch: 'main', ...extra });
    assert.equal(check().status, 'ready');
    const other = join(root, 'other');
    git(root, ['clone', origin, other]); configure(other); git(other, ['checkout', 'main']);
    writeFileSync(join(other, 'package.json'), '{}'); git(other, ['add', '.']); git(other, ['commit', '-m', 'dependency']); git(other, ['push', 'origin', 'main']);
    assert.equal(check().status, 'base_changed');
    assert.equal(check({ sensitiveChecksAvailable: true }).status, 'ready');
    writeFileSync(join(other, 'change.txt'), 'upstream'); git(other, ['add', '.']); git(other, ['commit', '-m', 'overlap']); git(other, ['push', 'origin', 'main']);
    const drift = check({ sensitiveChecksAvailable: true });
    assert.equal(drift.status, 'base_changed');
    assert.deepEqual(drift.overlap, ['change.txt']);
    assert.equal(git(repo, ['rev-parse', 'refs/cc-nexs/candidates/07-demo/api']), source);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('exact merged-tree checks permit disjoint sensitive base changes without moving the tested ref', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-integration-check-'));
  try {
    const repo = join(root, 'repo');
    git(root, ['init', '--bare', join(root, 'remote.git')]);
    git(root, ['clone', join(root, 'remote.git'), repo]); configure(repo);
    git(repo, ['checkout', '-b', 'main']);
    writeFileSync(join(repo, 'base.txt'), 'base'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'base']); git(repo, ['push', 'origin', 'main']);
    git(repo, ['checkout', '-b', 'feature']);
    writeFileSync(join(repo, 'fix.txt'), 'fix'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'fix']);
    const source = git(repo, ['rev-parse', 'HEAD']);
    const ref = 'refs/cc-nexs/candidates/check/api'; git(repo, ['update-ref', ref, source]);
    git(repo, ['checkout', 'main']); writeFileSync(join(repo, 'package.json'), '{"name":"fixture"}');
    git(repo, ['add', '.']); git(repo, ['commit', '-m', 'base dependency']); git(repo, ['push', 'origin', 'main']);
    const target = git(repo, ['rev-parse', 'HEAD']);
    const options = { repo, repositoryId: 'api', candidateRef: ref, targetBranch: 'main', requireDisjointTargetChanges: true };
    assert.throws(() => integrateCandidateToTest(options), /BASE_CHANGED/);
    assert.throws(() => integrateCandidateToTest({ ...options, verifyIntegration: () => ({status:'passed', integrationCommit:source, proof:'wrong tree'}) }), /exact merged candidate/);
    assert.equal(git(repo, ['rev-parse', 'origin/main']), target);
    const result = integrateCandidateToTest({ ...options, verifyIntegration: payload => {
      assert.deepEqual(payload.sensitivePaths, ['package.json']);
      assert.equal(git(payload.worktree, ['show', 'HEAD:fix.txt']), 'fix');
      assert.equal(git(payload.worktree, ['show', 'HEAD:package.json']), '{"name":"fixture"}');
      return { status:'passed', integrationCommit:payload.integrationCommit, proof:'merged tree fixture checks passed' };
    }});
    assert.equal(result.integrationVerification.status, 'passed');
    assert.equal(git(repo, ['rev-parse', ref]), source);
    git(repo, ['merge-base', '--is-ancestor', source, 'origin/main']);
  } finally { rmSync(root, { recursive:true, force:true }); }
});

test('protected branch rejection retains the server reason instead of claiming base advanced', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-rejected-'));
  try {
    const origin = join(root, 'remote.git'), repo = join(root, 'repo');
    git(root, ['init', '--bare', origin]); git(root, ['clone', origin, repo]); configure(repo);
    git(repo, ['checkout', '-b', 'main']); writeFileSync(join(repo, 'base'), 'base'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'base']); git(repo, ['push', 'origin', 'main']);
    writeFileSync(join(repo, 'fix'), 'fix'); git(repo, ['add', '.']); git(repo, ['commit', '-m', 'fix']); git(repo, ['update-ref', 'refs/cc-nexs/candidates/rejected/api', 'HEAD']);
    writeFileSync(join(origin, 'hooks', 'pre-receive'), '#!/bin/sh\necho "protected branch" >&2\nexit 1\n', {mode:0o755});
    assert.throws(() => integrateCandidateToTest({repo, repositoryId:'api', candidateRef:'refs/cc-nexs/candidates/rejected/api', targetBranch:'main'}), /PUSH_REJECTED.*did not advance[\s\S]*protected branch/);
  } finally { rmSync(root, {recursive:true, force:true}); }
});

test('candidates that merged or rebased onto test history are refused; integrated features are not', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-test-history-'));
  const origin = join(root, 'origin.git');
  const repo = join(root, 'repo');
  const commitFile = (name) => {
    writeFileSync(join(repo, name), `${name}\n`);
    git(repo, ['add', name]);
    git(repo, ['commit', '-m', name]);
    return git(repo, ['rev-parse', 'HEAD']);
  };
  try {
    mkdirSync(origin);
    git(origin, ['init', '--bare']);
    git(root, ['clone', origin, repo]);
    configure(repo);
    git(repo, ['checkout', '-b', 'main']);
    commitFile('base.txt');
    git(repo, ['push', '-u', 'origin', 'main']);
    git(repo, ['checkout', '-b', 'other', 'main']);
    commitFile('other.txt');
    git(repo, ['checkout', '-b', 'integrated', 'main']);
    const integrated = commitFile('integrated.txt');
    git(repo, ['checkout', '-b', 'test', 'main']);
    git(repo, ['merge', '--no-ff', '--no-edit', 'other']);
    git(repo, ['merge', '--no-ff', '--no-edit', 'integrated']);
    git(repo, ['push', '-u', 'origin', 'test']);
    const check = (sourceCommit, testBranches = ['test']) => assertCandidateExcludesTestHistory({ repo, sourceCommit, baseBranch: 'main', testBranches });

    check(integrated);
    check(git(repo, ['rev-parse', 'origin/main']));

    git(repo, ['checkout', '-b', 'merged-test', 'main']);
    commitFile('merged.txt');
    git(repo, ['merge', '--no-edit', 'origin/test']);
    const mergedTest = git(repo, ['rev-parse', 'HEAD']);
    assert.throws(() => check(mergedTest), /TEST_HISTORY: .*contains 2 commit\(s\) from origin\/test that are not in origin\/main/);

    git(repo, ['checkout', '-b', 'rebased', 'main']);
    commitFile('rebased.txt');
    git(repo, ['rebase', 'origin/test']);
    assert.throws(() => check(git(repo, ['rev-parse', 'HEAD'])), /TEST_HISTORY/);

    check(mergedTest, ['test02', null]);
    check(mergedTest, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a deployed revision proves the integration when it is that commit or a later test tip containing it', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-deployed-revision-'));
  const origin = join(root, 'origin.git');
  const repo = join(root, 'repo');
  const commitFile = (name) => {
    writeFileSync(join(repo, name), `${name}\n`);
    git(repo, ['add', name]);
    git(repo, ['commit', '-m', name]);
    return git(repo, ['rev-parse', 'HEAD']);
  };
  try {
    mkdirSync(origin);
    git(origin, ['init', '--bare']);
    git(root, ['clone', origin, repo]);
    configure(repo);
    git(repo, ['checkout', '-b', 'test']);
    const before = commitFile('before.txt');
    const integrationCommit = commitFile('integration.txt');
    const laterTip = commitFile('other-team.txt');
    git(repo, ['push', '-u', 'origin', 'test']);
    git(repo, ['checkout', '-b', 'unrelated', before]);
    const unrelated = commitFile('unrelated.txt');
    const resolve = (revision) => resolveDeployedRevision({ repo, targetBranch: 'test', revision, integrationCommit });

    assert.deepEqual(resolve(integrationCommit), { revision: integrationCommit, relation: 'exact' });
    assert.deepEqual(resolve(integrationCommit.slice(0, 9)), { revision: integrationCommit, relation: 'exact' });
    assert.deepEqual(resolve(laterTip.slice(0, 12)), { revision: laterTip, relation: 'contains' });
    assert.equal(resolve(before), null);
    assert.equal(resolve(unrelated), null);
    assert.equal(resolve('not-a-sha'), null);
    assert.equal(resolve('f'.repeat(40)), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a dedicated Test target accepts its own integrations and refuses foreign work', () => {
  const fixture = mrFixture('cc-nexs-dedicated-');
  try {
    const { root, origin, repo, source } = fixture;
    git(repo, ['push', 'origin', 'origin/main:refs/heads/test02']);
    const check = (ownCommits = []) => assertDedicatedTargetFree({ repo, targetBranch: 'test02', baseBranch: 'main', sourceCommit: source, ownCommits });
    assert.equal(check().free, true);
    const result = integrateCandidateToTest({ repo, repositoryId: 'api', candidateRef: 'refs/cc-nexs/candidates/07-demo/api', targetBranch: 'test02' });
    assert.throws(() => check(), /TARGET_OCCUPIED: origin\/test02 carries 1 commit/);
    assert.equal(check([result.integrationCommit]).free, true);
    const other = join(root, 'other');
    git(root, ['clone', origin, other]); configure(other); git(other, ['checkout', 'test02']);
    writeFileSync(join(other, 'theirs.txt'), 'another feature'); git(other, ['add', '.']); git(other, ['commit', '-m', 'their feature']); git(other, ['push', 'origin', 'test02']);
    assert.throws(() => check([result.integrationCommit]), /TARGET_OCCUPIED: origin\/test02 carries 1 commit/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('merged-work classification separates ancestry, ported patches and remaining work', () => {
  const fixture = mrFixture('cc-nexs-merged-work-');
  try {
    const { root, origin, repo, source } = fixture;
    assert.equal(classifyMergedWork({ repo, head: source, baseBranch: 'main' }).status, 'unmerged');
    const other = join(root, 'other');
    git(root, ['clone', origin, other]); configure(other); git(other, ['checkout', 'main']);
    writeFileSync(join(other, 'unrelated.txt'), 'x'); git(other, ['add', '.']); git(other, ['commit', '-m', 'unrelated']);
    git(other, ['fetch', join(root, 'repo'), 'feature/07-demo']);
    git(other, ['cherry-pick', 'FETCH_HEAD']); git(other, ['push', 'origin', 'main']);
    assert.deepEqual(classifyMergedWork({ repo, head: source, baseBranch: 'main' }), { status: 'merged', relation: 'patch-equivalent', commits: 1 });
    git(other, ['fetch', join(root, 'repo'), 'feature/07-demo']);
    git(other, ['merge', '--no-edit', 'FETCH_HEAD']); git(other, ['push', 'origin', 'main']);
    assert.deepEqual(classifyMergedWork({ repo, head: source, baseBranch: 'main' }), { status: 'merged', relation: 'ancestor' });
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
