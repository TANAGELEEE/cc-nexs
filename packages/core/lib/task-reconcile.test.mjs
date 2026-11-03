import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { createProgressV2, readProgressV2, writeProgressV2 } from './progress-v2.mjs';
import { reconcileTask } from './task-reconcile.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-reconcile-'));
  roots.push(root);
  const origin = join(root, 'origin.git');
  const code = join(root, 'code');
  git(root, ['init', '-q', '--bare', origin]);
  git(root, ['clone', '-q', origin, code]);
  git(code, ['config', 'user.name', 'Reconcile Test']);
  git(code, ['config', 'user.email', 'reconcile@example.com']);
  git(code, ['checkout', '-q', '-b', 'master']);
  writeFileSync(join(code, 'base.txt'), 'base\n');
  git(code, ['add', '.']); git(code, ['commit', '-q', '-m', 'base']); git(code, ['push', '-q', '-u', 'origin', 'master']);
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'workspace.json'), `${JSON.stringify({ version: 1, repositories: [{ id: 'code', path: 'code', base_branch: 'master' }] })}\n`);
  const commit = (name) => { writeFileSync(join(code, name), `${name}\n`); git(code, ['add', name]); git(code, ['commit', '-q', '-m', name]); return git(code, ['rev-parse', 'HEAD']); };
  const branch = (name, files) => {
    const base = git(code, ['rev-parse', 'origin/master']);
    git(code, ['checkout', '-q', '-b', name, base]);
    const commits = files.map(commit);
    git(code, ['checkout', '-q', 'master']);
    return { base, commits };
  };
  const port = (commits) => {
    commit(`other-${Math.random().toString(16).slice(2)}.txt`);
    for (const sha of commits) git(code, ['cherry-pick', sha]);
    git(code, ['push', '-q', 'origin', 'master']);
  };
  const task = (id, assignment, { mode = 'full', state = 'SPRINT_11_FIX' } = {}) => {
    const dir = join(root, '.cc-nexs', 'hotfixes', id);
    mkdirSync(dir, { recursive: true });
    const progress = createProgressV2({ featureId: id, featureSlug: 'demo', preset: 'preset-standard', mode: mode === 'full' ? 'lean' : mode });
    progress.repositories.code = assignment;
    const file = join(dir, 'progress.json');
    writeProgressV2(file, progress);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    raw.mode = mode;
    raw.state = state;
    writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
    writeFileSync(join(dir, 'progress.md'), `## 当前状态\n\n\`\`\`yaml\ncurrent_state: ${state}\nupdated_at: null\n\`\`\`\n\n## 历史轨迹\n\n- (尚无)\n`);
    return file;
  };
  return { root, code, branch, port, task };
}

test('a retired-mode task whose commits were ported is completed only after confirming the shown plan', () => {
  const ws = workspace();
  const work = ws.branch('feature/307-demo', ['a.txt', 'b.txt']);
  ws.port(work.commits);
  const file = ws.task('307', { branch: 'feature/307-demo', base_branch: 'master', base_commit: work.base, worktree: null, candidate: null });
  const plan = reconcileTask({ cwd: ws.root, featureId: '307', progressPath: file });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.legacy, true);
  assert.deepEqual(plan.repositories.map(({ status, relation, commits }) => ({ status, relation, commits })), [{ status: 'merged', relation: 'patch-equivalent', commits: 2 }]);
  assert.throws(() => reconcileTask({ cwd: ws.root, featureId: '307', progressPath: file, confirm: 'deadbeef0000' }), /plan changed/);
  const done = reconcileTask({ cwd: ws.root, featureId: '307', progressPath: file, confirm: plan.token });
  assert.equal(done.status, 'reconciled');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(raw.state, 'COMPLETE');
  assert.equal(raw.mode, 'full');
  assert.equal(raw.events.at(-1).from, 'SPRINT_11_FIX');
  assert.equal(raw.events.at(-1).sequence, raw.events.length);
  assert.match(readFileSync(file.replace('progress.json', 'progress.md'), 'utf8'), /current_state: COMPLETE/);
  assert.equal(reconcileTask({ cwd: ws.root, featureId: '307', progressPath: file }).status, 'complete');
});

test('unported work or a branch without its own commits blocks reconcile', () => {
  const ws = workspace();
  const partial = ws.branch('feature/308-demo', ['c.txt', 'd.txt']);
  ws.port(partial.commits.slice(0, 1));
  const file = ws.task('308', { branch: 'feature/308-demo', base_branch: 'master', base_commit: partial.base, worktree: null, candidate: null });
  const blocked = reconcileTask({ cwd: ws.root, featureId: '308', progressPath: file });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.repositories[0].missing.length, 1);
  assert.equal(blocked.token, undefined);
  assert.equal(reconcileTask({ cwd: ws.root, featureId: '308', progressPath: file, confirm: 'anything' }).status, 'blocked');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).state, 'SPRINT_11_FIX');

  const fresh = ws.branch('feature/309-demo', []);
  const freshFile = ws.task('309', { branch: 'feature/309-demo', base_branch: 'master', base_commit: fresh.base, worktree: null, candidate: null });
  const unknown = reconcileTask({ cwd: ws.root, featureId: '309', progressPath: freshFile });
  assert.equal(unknown.status, 'blocked');
  assert.match(unknown.repositories[0].reason, /no candidate ref, or branch with commits beyond its recorded base/);
});

test('a current-mode task merged outside the controller is completed through the progress ledger', () => {
  const ws = workspace();
  const work = ws.branch('hotfix/BUG-1', ['fix.txt']);
  git(ws.code, ['update-ref', 'refs/cc-nexs/candidates/BUG-1/code', work.commits[0]]);
  git(ws.code, ['push', '-q', 'origin', `${work.commits[0]}:master`]);
  const file = ws.task('BUG-1', { branch: 'hotfix/BUG-1', base_branch: 'master', worktree: null, candidate: { commit: null, ref: 'refs/cc-nexs/candidates/BUG-1/code', paths: [] } }, { mode: 'hotfix', state: 'HOTFIX_BASE_MERGE_BLOCKED' });
  const blocked = JSON.parse(readFileSync(file, 'utf8'));
  blocked.delivery.base = { status: 'failed', attempts: [{ id: 'base-release-1', status: 'failed', integrations: {}, reason: 'PUSH_REJECTED' }] };
  writeFileSync(file, `${JSON.stringify(blocked, null, 2)}\n`);
  const plan = reconcileTask({ cwd: ws.root, featureId: 'BUG-1', progressPath: file });
  assert.equal(plan.legacy, false);
  assert.equal(plan.repositories[0].relation, 'ancestor');
  reconcileTask({ cwd: ws.root, featureId: 'BUG-1', progressPath: file, confirm: plan.token });
  const progress = readProgressV2(file);
  assert.equal(progress.state, 'COMPLETE');
  assert.equal(progress.events.at(-1).type, 'state.transition');
  assert.equal(progress.delivery.base.status, 'succeeded');
  assert.deepEqual(progress.delivery.base.attempts.at(-1).integrations.code, { source_commit: work.commits[0], target_branch: 'master', merge_relation: 'ancestor' });
  assert.equal(progress.delivery.base.attempts.at(-1).reconciled, true);
});
