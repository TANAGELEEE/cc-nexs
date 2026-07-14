import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { commitCandidate, createWorkspaceWorktrees, finalizeMergedWorktree, prepareFeatureForMerge } from './git-custodian.mjs';
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
    const candidate = commitCandidate({
      repositoryId: 'docs', repo, worktree: item.worktree, branch: item.branch,
      featureKey: '01-demo', paths: ['feature.md', 'progress.json'], message: 'docs: candidate', progressFile,
    });
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
    const prepared = prepareFeatureForMerge({
      repo, worktree: item.worktree, branch: item.branch, baseBranch: 'master', candidateRef: candidate.candidateRef,
    });
    assert.equal(prepared.updated, true);
    assert.equal(git(item.worktree, ['show', 'HEAD:upstream.md']), 'new base');
    assert.throws(() => git(item.worktree, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']));

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
