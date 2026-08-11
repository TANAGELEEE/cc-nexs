import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  commitCandidate,
  createWorkspaceWorktrees,
  finalizeMergedWorktree,
  integrateCandidateToTest,
  prepareFeatureForMerge,
} from './git-custodian.mjs';
import { createProgressV2, readProgressV2, recordRepositoryAssignments, writeProgressV2 } from './progress-v2.mjs';

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
