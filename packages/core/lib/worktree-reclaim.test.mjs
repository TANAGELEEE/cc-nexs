import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('task files and legacy drafts follow task state; only rebuildable draft caches are reclaimed', () => {
  const { root, task } = fixture();
  try {
    task('h-done', { state: 'COMPLETE', merge: true });
    task('h-active', { state: 'HOTFIX_IMPLEMENTING', commit: false });
    const files = (id) => join(root, '.cc-nexs', 'runtime', 'tasks', id);
    for (const id of ['h-done', 'h-active', 'h-orphan']) {
      mkdirSync(join(files(id), 'scratch', 'export'), { recursive: true });
      writeFileSync(join(files(id), 'request.json'), '{}\n');
    }
    const drafts = join(root, '.cc-nexs', 'drafts');
    const doneDraft = join(drafts, 'h-done');
    mkdirSync(join(doneDraft, 'verify-1', 'web', 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(doneDraft, 'verify-1', 'web', '.next', 'cache'), { recursive: true });
    writeFileSync(join(doneDraft, 'verify-1', 'web', 'page.tsx'), 'export {}\n');
    writeFileSync(join(doneDraft, 'verify-1', 'result.json'), '{}\n');
    mkdirSync(join(doneDraft, 'checkout', 'node_modules'), { recursive: true });
    writeFileSync(join(doneDraft, 'checkout', '.git'), 'gitdir: elsewhere\n');
    mkdirSync(join(drafts, 'h-active', 'web', 'node_modules'), { recursive: true });
    mkdirSync(join(drafts, 'unrelated', 'node_modules'), { recursive: true });

    const inventory = inventoryWorktrees({ cwd: root });
    assert.equal(byPath(inventory, 'runtime/tasks/h-done').action, 'reclaim');
    assert.match(byPath(inventory, 'runtime/tasks/h-active').reason, /active task h-active/);
    assert.match(byPath(inventory, 'runtime/tasks/h-orphan').reason, /no task state/);
    assert.equal(byPath(inventory, 'drafts/h-done/verify-1/web/node_modules').action, 'reclaim');
    assert.equal(byPath(inventory, 'drafts/h-done/verify-1/web/.next').action, 'reclaim');
    assert.equal(byPath(inventory, 'drafts/h-done/checkout/node_modules'), undefined);
    assert.match(byPath(inventory, 'drafts/h-done').reason, /not managed by cc-nexs, inspect manually/);
    assert.match(byPath(inventory, 'drafts/h-active').reason, /active task h-active/);
    assert.match(byPath(inventory, 'drafts/unrelated').reason, /no matching task/);
    assert.equal(byPath(inventory, 'drafts/unrelated/node_modules'), undefined);

    const applied = reclaimWorktrees({ cwd: root, confirm: inventory.token });
    assert.equal(applied.failed.length, 0, JSON.stringify(applied.failed));
    assert.equal(existsSync(files('h-done')), false);
    assert.ok(existsSync(files('h-active')));
    assert.equal(existsSync(join(doneDraft, 'verify-1', 'web', 'node_modules')), false);
    assert.equal(existsSync(join(doneDraft, 'verify-1', 'web', '.next')), false);
    assert.ok(existsSync(join(doneDraft, 'verify-1', 'web', 'page.tsx')));
    assert.ok(existsSync(join(doneDraft, 'verify-1', 'result.json')));
    assert.ok(existsSync(join(doneDraft, 'checkout', 'node_modules')));
    assert.ok(existsSync(join(drafts, 'unrelated', 'node_modules')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('inventory explains ported work, keeps retired-mode tasks visible, and reports legacy MR branches', () => {
  const { root, code, task } = fixture();
  try {
    const ported = task('h-ported', { state: 'COMPLETE' });
    git(code, ['checkout', '-q', 'master']);
    writeFileSync(join(code, 'other.txt'), 'other team\n');
    git(code, ['add', 'other.txt']);
    git(code, ['commit', '-q', '-m', 'other team']);
    git(code, ['cherry-pick', git(ported.worktree, ['rev-parse', 'HEAD'])]);
    git(code, ['push', '-q', 'origin', 'master']);
    git(code, ['fetch', '-q', 'origin']);
    const legacy = task('h-legacy', { state: 'COMPLETE' });
    const legacyFile = join(root, '.cc-nexs', 'hotfixes', 'h-legacy', 'progress.json');
    const record = JSON.parse(readFileSync(legacyFile, 'utf8'));
    Object.assign(record, { mode: 'full', state: 'SPRINT_11_FIX' });
    writeFileSync(legacyFile, `${JSON.stringify(record, null, 2)}\n`);
    git(code, ['push', '-q', 'origin', `${git(legacy.worktree, ['rev-parse', 'HEAD'])}:refs/heads/cc-nexs-mr-code-${'a'.repeat(40)}`]);

    const inventory = inventoryWorktrees({ cwd: root });
    assert.match(byPath(inventory, 'h-ported/code').reason, /all 1 commit\(s\) are patch-equivalent in origin\/master/);
    assert.match(byPath(inventory, 'h-legacy/code').reason, /active task h-legacy \(SPRINT_11_FIX\); legacy full-mode task, run reconcile h-legacy/);
    const branch = inventory.entries.find((entry) => entry.kind === 'remote-branch');
    assert.equal(branch.action, 'keep');
    assert.equal(branch.display, `origin/cc-nexs-mr-code-${'a'.repeat(40)} (code)`);
    assert.match(branch.reason, /legacy cc-nexs MR branch not merged into origin\/master/);
    const applied = reclaimWorktrees({ cwd: root, confirm: inventory.token });
    assert.equal(applied.removed.length, 0);
    assert.match(git(code, ['ls-remote', '--heads', 'origin', 'cc-nexs-mr-*']), /cc-nexs-mr-code-/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
