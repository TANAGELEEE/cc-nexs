import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createProgressV2, writeProgressV2 } from './progress-v2.mjs';
import { testBranchMergeSource, workspaceTestBranches } from './test-branch-guard.mjs';

test('detects merging, rebasing or pulling a test branch but not other Git commands', () => {
  const branches = new Set(['test', 'test02']);
  for (const command of [
    'git merge --no-edit origin/test',
    'git merge test',
    'git -C backend-java merge refs/remotes/origin/test',
    'git rebase origin/test',
    'git rebase --onto origin/test02 main',
    'git pull origin test',
    'git pull --rebase origin test02',
    'git fetch origin && git merge "origin/test"',
  ]) assert.notEqual(testBranchMergeSource(command, branches), null, command);
  for (const command of [
    'git merge --no-edit origin/master',
    'git merge feature/347-video-clone-sync',
    'git merge -m "sync test" origin/master',
    'git merge-base --is-ancestor origin/test HEAD',
    'git log origin/test',
    'git push origin test',
    'git fetch origin test',
    'git checkout test',
    'git pull',
  ]) assert.equal(testBranchMergeSource(command, branches), null, command);
});

test('hook blocks every session from merging configured or switched test branches inside a workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-test-guard-'));
  const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'git-custodian-guard.mjs');
  const run = (command, cwd, role = '') => spawnSync(process.execPath, [hook], {
    cwd, input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8',
    env: { ...process.env, CC_NEXS_ROLE: role },
  });
  try {
    mkdirSync(join(root, '.cc-nexs'), { recursive: true });
    writeFileSync(join(root, '.cc-nexs', 'workspace.json'), JSON.stringify({
      version: 1,
      worktree_root: '.worktrees',
      docs_repository: 'docs',
      repositories: [
        { id: 'docs', path: 'docs', base_branch: 'master', docs: true },
        { id: 'api', path: 'api', base_branch: 'master', test_branch: 'test' },
      ],
    }));
    const progress = createProgressV2({ featureId: '01', featureSlug: 'demo', preset: 'preset-standard', mode: 'lean' });
    progress.delivery.test.target = { kind: 'test', environment: 'test02', branches: { api: 'test02' } };
    const progressFile = join(root, 'docs', 'doc', '01.demo', 'progress.json');
    mkdirSync(dirname(progressFile), { recursive: true });
    writeProgressV2(progressFile, progress);
    const feature = join(root, '.worktrees', '01-demo', 'api');
    mkdirSync(feature, { recursive: true });

    assert.deepEqual([...workspaceTestBranches(feature)].sort(), ['test', 'test02']);
    const blocked = run('git merge --no-edit origin/test', feature);
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /BLOCKED: merging, rebasing or pulling test branch test/);
    assert.equal(run('git pull origin test02', feature).status, 2);
    assert.equal(run('git rebase origin/test', feature, 'git-custodian').status, 2);
    assert.equal(run('git merge --no-edit origin/master', feature).status, 0);
    assert.equal(run('git merge --no-edit origin/test', root.replace(/[^/]+$/, '')).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
