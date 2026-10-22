import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createProgressV2, writeProgressV2 } from './progress-v2.mjs';
import { inventoryWorktrees, reclaimWorktrees } from './worktree-reclaim.mjs';

const lib = dirname(fileURLToPath(import.meta.url));

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-reclaim-'));
  const origin = join(root, 'origin.git');
  const code = join(root, 'code');
  mkdirSync(origin);
  git(origin, ['init', '--bare']);
  git(root, ['clone', origin, code]);
  git(code, ['config', 'user.name', 'Reclaim Test']);
  git(code, ['config', 'user.email', 'reclaim@example.com']);
  git(code, ['checkout', '-b', 'master']);
  writeFileSync(join(code, '.gitignore'), 'node_modules/\n');
  git(code, ['add', '.gitignore']);
  git(code, ['commit', '-m', 'base']);
  git(code, ['push', '-u', 'origin', 'master']);
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'workspace.json'), `${JSON.stringify({
    version: 1, repositories: [{ id: 'code', path: 'code', base_branch: 'master', test_branch: 'test' }],
  })}\n`);

  // Each task gets a hotfix-style worktree plus progress in the workspace state directory.
  const task = (key, { state, commit = true, merge = false, progress = true } = {}) => {
    const worktree = join(root, '.worktrees', key, 'code');
    git(code, ['worktree', 'add', '-b', `hotfix/${key}`, worktree, 'origin/master']);
    const candidateRef = `refs/cc-nexs/candidates/${key}/code`;
    if (commit) {
      writeFileSync(join(worktree, `${key}.txt`), `${key}\n`);
      git(worktree, ['add', `${key}.txt`]);
      git(worktree, ['commit', '-m', key]);
      git(code, ['update-ref', candidateRef, git(worktree, ['rev-parse', 'HEAD'])]);
    }
    if (merge) {
      git(worktree, ['push', 'origin', `HEAD:refs/heads/hotfix/${key}`]);
      git(worktree, ['push', 'origin', 'HEAD:master']);
      git(code, ['fetch', 'origin']);
    }
    if (progress) {
      const record = createProgressV2({ featureId: key, featureSlug: key, preset: 'preset-standard', mode: 'hotfix' });
      record.state = state;
      record.repositories.code = { branch: `hotfix/${key}`, worktree: `.worktrees/${key}/code`, base_branch: 'master', candidate: { commit: null, ref: candidateRef, paths: [] } };
      mkdirSync(join(root, '.cc-nexs', 'hotfixes', key), { recursive: true });
      writeProgressV2(join(root, '.cc-nexs', 'hotfixes', key, 'progress.json'), record);
    }
    return { worktree, candidateRef };
  };
  return { root, code, task };
}

const byPath = (result, suffix) => result.entries.find((entry) => entry.display.replaceAll('\\', '/').endsWith(suffix));

test('inventory reclaims only completed merged clean worktrees and stale copies', () => {
  const { root, code, task } = fixture();
  try {
    const done = task('h-done', { state: 'COMPLETE', merge: true });
    mkdirSync(join(done.worktree, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(done.worktree, 'node_modules', 'pkg', 'index.js'), 'x'.repeat(2048));
    task('h-active', { state: 'HOTFIX_IMPLEMENTING', commit: false });
    task('h-blocked', { state: 'HOTFIX_BASE_MERGE_BLOCKED', merge: true });
    const dirty = task('h-dirty', { state: 'COMPLETE', merge: true });
    writeFileSync(join(dirty.worktree, 'notes.txt'), 'local work\n');
    task('h-unmerged', { state: 'COMPLETE' });
    task('h-unknown', { commit: false, progress: false });
    const stale = join(root, '.worktrees', 'h-stale', 'code');
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, '.git'), `gitdir: ${join(root, 'code', '.git', 'worktrees', 'gone')}\n`);
    const manual = join(root, '.worktrees', 'h-manual', 'code');
    mkdirSync(manual, { recursive: true });
    writeFileSync(join(manual, 'keep.txt'), 'not a worktree\n');

    // Test conflict copies: the latest live conflict stays, an older attempt is reclaimed.
    const conflicts = join(root, '.cc-nexs', 'runtime', 'test-conflicts', 'h-active');
    mkdirSync(conflicts, { recursive: true });
    git(code, ['worktree', 'add', '--detach', join(conflicts, 'test-release-1', 'code'), 'origin/master']);
    git(code, ['worktree', 'add', '--detach', join(conflicts, 'test-release-2', 'code'), 'origin/master']);
    const activeFile = join(root, '.cc-nexs', 'hotfixes', 'h-active', 'progress.json');
    const active = JSON.parse(execFileSync('cat', [activeFile], { encoding: 'utf8' }));
    active.delivery.test.attempts = [
      { id: 'test-release-1', status: 'merge_conflict', invalidated_at: '2026-10-22T00:00:00.000Z' },
      { id: 'test-release-2', status: 'merge_conflict', invalidated_at: null },
    ];
    writeFileSync(activeFile, `${JSON.stringify(active, null, 2)}\n`);

    const inventory = inventoryWorktrees({ cwd: root, sizes: true });
    assert.equal(byPath(inventory, 'h-done/code').action, 'reclaim');
    assert.ok(byPath(inventory, 'h-done/code').bytes >= 2048);
    assert.match(byPath(inventory, 'h-active/code').reason, /active task h-active/);
    assert.match(byPath(inventory, 'h-blocked/code').reason, /rerun release-base/);
    assert.match(byPath(inventory, 'h-dirty/code').reason, /uncommitted/);
    assert.match(byPath(inventory, 'h-unmerged/code').reason, /not merged/);
    assert.match(byPath(inventory, 'h-unknown/code').reason, /no task state/);
    assert.equal(byPath(inventory, 'h-stale/code').action, 'reclaim');
    assert.match(byPath(inventory, 'h-manual/code').reason, /not a registered worktree/);
    assert.equal(byPath(inventory, 'test-release-1/code').action, 'reclaim');
    assert.match(byPath(inventory, 'test-release-2/code').reason, /active conflict/);

    // The CLI dry run prints the plan; doctor shows the same inventory read-only.
    const cli = spawnSync(process.execPath, [join(lib, 'cc-nexs-cli.mjs'), 'reclaim-worktrees'], { cwd: root, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, new RegExp(`--confirm ${inventory.token}`));
    const doctor = spawnSync(process.execPath, [join(lib, 'doctor.mjs'), root, '--worktrees'], { encoding: 'utf8' });
    assert.match(doctor.stdout, /Worktree inventory: 3 reclaimable/);
    assert.ok(existsSync(done.worktree));

    assert.throws(() => reclaimWorktrees({ cwd: root, confirm: 'deadbeef0000' }), /plan changed/);
    const applied = reclaimWorktrees({ cwd: root, confirm: inventory.token });
    assert.equal(applied.failed.length, 0, JSON.stringify(applied.failed));
    assert.equal(applied.removed.length, 3);
    assert.equal(existsSync(done.worktree), false);
    assert.equal(existsSync(join(root, '.worktrees', 'h-done')), false);
    assert.throws(() => git(code, ['show-ref', '--verify', 'refs/heads/hotfix/h-done']));
    assert.throws(() => git(code, ['show-ref', '--verify', done.candidateRef]));
    assert.match(git(code, ['ls-remote', '--heads', 'origin', 'hotfix/h-done']), /hotfix\/h-done/);
    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(join(conflicts, 'test-release-1')), false);
    assert.doesNotMatch(git(code, ['worktree', 'list', '--porcelain']), /test-release-1/);
    for (const kept of ['h-active', 'h-blocked', 'h-dirty', 'h-unmerged', 'h-unknown', 'h-manual']) {
      assert.ok(existsSync(join(root, '.worktrees', kept, 'code')), kept);
    }
    assert.ok(existsSync(join(conflicts, 'test-release-2', 'code')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reclaim refuses a plan that changed after it was shown', () => {
  const { root, task } = fixture();
  try {
    const done = task('h-done', { state: 'COMPLETE', merge: true });
    const { token } = inventoryWorktrees({ cwd: root });
    writeFileSync(join(done.worktree, 'late.txt'), 'new work\n');
    assert.throws(() => reclaimWorktrees({ cwd: root, confirm: token }), /plan changed/);
    assert.ok(existsSync(join(done.worktree, 'late.txt')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
