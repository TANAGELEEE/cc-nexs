import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { finalizeDocs } from './docs-finalize.mjs';
import { createProgressV2, writeProgressV2 } from './progress-v2.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const configure = (repo) => { git(repo, ['config', 'user.name', 'Docs Test']); git(repo, ['config', 'user.email', 'docs@example.com']); };

function createReleasedTask({ mode = 'lean', driver = false, stray = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-docs-finalize-'));
  roots.push(root);
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../preset-standard/preset.yml'), join(root, '.cc-nexs', 'preset.yml'));
  writeFileSync(join(root, 'cc-nexs.config.yml'), driver
    ? `preset_path: .cc-nexs\nrelease:\n  base:\n    driver:\n      command: ${process.execPath}\n      args: [mr.mjs]\n`
    : 'preset_path: .cc-nexs\n');
  writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), 'version: 1\ndocs_repository: docs\nrepositories:\n  - id: docs\n    path: all-docs\n    docs: true\n    base_branch: main\n');
  const remote = join(root, 'docs.git');
  const repo = join(root, 'all-docs');
  git(root, ['init', '-q', '--bare', remote]);
  git(root, ['clone', '-q', remote, repo]);
  configure(repo);
  git(repo, ['checkout', '-q', '-b', 'main']);
  writeFileSync(join(repo, 'README.md'), 'docs\n');
  git(repo, ['add', '.']); git(repo, ['commit', '-q', '-m', 'init']); git(repo, ['push', '-q', 'origin', 'main']);
  const key = mode === 'hotfix' ? 'BUG-07' : '07-demo';
  const branch = `${mode === 'hotfix' ? 'hotfix' : 'feature'}/${key}`;
  const worktreeRel = join('.worktrees', key, 'docs');
  const worktree = join(root, worktreeRel);
  git(repo, ['worktree', 'add', '-q', '--no-track', '-b', branch, worktree, 'origin/main']);
  const progress = createProgressV2({ featureId: mode === 'hotfix' ? 'BUG-07' : '07', featureSlug: 'demo', preset: 'preset-standard', mode });
  progress.state = 'COMPLETE';
  progress.delivery.base = { status: 'succeeded', attempts: [{ id: 'base-release-1', status: 'succeeded', integrations: {} }] };
  progress.gates.release = { approved: true, approver: 'Owner', approved_at: '2026-11-03T00:00:00.000Z', binding: { candidate_fingerprint: 'f'.repeat(64), source: { api: 'a'.repeat(40) } } };
  progress.review = { ...progress.review, status: 'passed', candidate_fingerprint: 'f'.repeat(64) };
  progress.repositories.docs = { branch, worktree: worktreeRel, base_branch: 'main', base_commit: git(repo, ['rev-parse', 'origin/main']), candidate: null };
  let progressFile;
  if (mode === 'hotfix') {
    progress.hotfix_document = { repository: 'docs', path: 'hotfix/BUG-07/BUG-001.md' };
    mkdirSync(join(worktree, 'hotfix', 'BUG-07'), { recursive: true });
    writeFileSync(join(worktree, 'hotfix', 'BUG-07', 'BUG-001.md'), '# BUG\n');
    const stateDir = join(root, '.cc-nexs', 'hotfixes', 'BUG-07');
    mkdirSync(stateDir, { recursive: true });
    progressFile = join(stateDir, 'progress.json');
    writeFileSync(join(stateDir, 'progress.md'), '## 当前状态\n\n```yaml\ncurrent_state: COMPLETE\n```\n');
  } else {
    const docs = join(worktree, 'doc', '07.demo');
    mkdirSync(docs, { recursive: true });
    for (const name of ['requirements.md', 'plan.md', 'progress.md']) writeFileSync(join(docs, name), `# ${name}\n`);
    writeFileSync(join(docs, 'config.json'), '{}\n');
    if (stray) writeFileSync(join(docs, 'scratch.html'), 'not archived\n');
    progressFile = join(docs, 'progress.json');
  }
  writeProgressV2(progressFile, progress);
  writeFileSync(join(root, 'mr.mjs'), `import {execFileSync} from 'node:child_process'; let s=''; for await (const c of process.stdin) s+=c; const p=JSON.parse(s); execFileSync('git',['-C',${JSON.stringify(repo)},'push','-q','origin',p.sourceCommit+':refs/heads/'+p.sourceBranch]); console.log(JSON.stringify({status:'pending',url:'https://git.example/docs/mr/3'}));`);
  return { root, remote, repo, branch, worktree, progressFile };
}

test('finalize-docs archives the five Lean files with intact release evidence and cleans up', () => {
  const task = createReleasedTask({ stray: true });
  assert.throws(() => finalizeDocs({ cwd: task.root, featureId: '07', progressPath: task.progressFile }), /changes outside the final docs \(doc\/07\.demo\/scratch\.html\)/);
  assert.throws(() => git(task.repo, ['rev-parse', '--verify', 'refs/cc-nexs/candidates/07-demo/docs']));
  rmSync(join(dirname(task.progressFile), 'scratch.html'));
  const taskFiles = join(task.root, '.cc-nexs', 'runtime', 'tasks', '07');
  const otherTaskFiles = join(task.root, '.cc-nexs', 'runtime', 'tasks', '08');
  for (const dir of [taskFiles, otherTaskFiles]) { mkdirSync(join(dir, 'scratch'), { recursive: true }); writeFileSync(join(dir, 'receipt.json'), '{}\n'); }
  const result = finalizeDocs({ cwd: task.root, featureId: '07', progressPath: task.progressFile });
  assert.equal(result.status, 'merged');
  assert.equal(result.created, true);
  assert.equal(existsSync(taskFiles), false, 'the completed task\'s own files are reclaimed');
  assert.equal(existsSync(otherTaskFiles), true, 'another task\'s files stay');
  assert.deepEqual(result.reclaimed.removed.map((entry) => entry.kind), ['task-files']);
  const archived = JSON.parse(git(task.repo, ['show', 'origin/main:doc/07.demo/progress.json']));
  assert.equal(archived.gates.release.approved, true);
  assert.equal(archived.gates.release.binding.candidate_fingerprint, 'f'.repeat(64));
  assert.equal(archived.review.status, 'passed');
  assert.equal(archived.repositories.docs.candidate.ref, 'refs/cc-nexs/candidates/07-demo/docs');
  assert.deepEqual(git(task.repo, ['ls-tree', '--name-only', 'origin/main', 'doc/07.demo/']).split('\n').sort(),
    ['config.json', 'plan.md', 'progress.json', 'progress.md', 'requirements.md'].map((name) => `doc/07.demo/${name}`));
  assert.equal(existsSync(task.worktree), false);
  assert.equal(git(task.repo, ['ls-remote', '--heads', 'origin', `refs/heads/${task.branch}`]), '');
  git(task.repo, ['pull', '-q', 'origin', 'main']);
  assert.equal(finalizeDocs({ cwd: task.root, featureId: '07', progressPath: join(task.repo, 'doc', '07.demo', 'progress.json') }).alreadyFinalized, true);
});

test('finalize-docs goes through the MR driver from the docs feature branch and resumes after merge', () => {
  const task = createReleasedTask({ driver: true });
  const pending = finalizeDocs({ cwd: task.root, featureId: '07', progressPath: task.progressFile });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.mergeRequest.url, 'https://git.example/docs/mr/3');
  assert.equal(git(task.repo, ['ls-remote', '--heads', 'origin', `refs/heads/${task.branch}`]).split(/\s+/)[0], pending.sourceCommit);
  assert.equal(git(task.repo, ['ls-remote', '--heads', 'origin', 'cc-nexs-mr-*']), '');
  const server = join(task.root, 'server');
  git(task.root, ['clone', '-q', task.remote, server]); configure(server);
  git(server, ['checkout', '-q', 'main']);
  git(server, ['merge', '--no-ff', '--no-edit', `origin/${task.branch}`]);
  git(server, ['push', '-q', 'origin', 'main']);
  const merged = finalizeDocs({ cwd: task.root, featureId: '07', progressPath: task.progressFile });
  assert.equal(merged.status, 'merged');
  assert.equal(merged.created, false);
  assert.equal(merged.integrationCommit, git(server, ['rev-parse', 'HEAD']));
  assert.equal(existsSync(task.worktree), false);
  assert.equal(git(task.repo, ['ls-remote', '--heads', 'origin', `refs/heads/${task.branch}`]), '');
});

test('finalize-docs archives only the BUG document for a new Hotfix and reports an already finalized task', () => {
  const task = createReleasedTask({ mode: 'hotfix' });
  assert.equal(finalizeDocs({ cwd: task.root, featureId: 'BUG-07', progressPath: task.progressFile }).status, 'merged');
  assert.equal(git(task.repo, ['ls-tree', '-r', '--name-only', 'origin/main', 'hotfix/']), 'hotfix/BUG-07/BUG-001.md');
  const again = finalizeDocs({ cwd: task.root, featureId: 'BUG-07', progressPath: task.progressFile });
  assert.equal(again.alreadyFinalized, true);
});

test('finalize-docs refuses a task whose code base release has not succeeded', () => {
  const task = createReleasedTask();
  const progress = JSON.parse(readFileSync(task.progressFile, 'utf8'));
  progress.state = 'BASE_MERGING';
  writeProgressV2(task.progressFile, progress);
  assert.throws(() => finalizeDocs({ cwd: task.root, featureId: '07', progressPath: task.progressFile }), /requires COMPLETE after a succeeded base release/);
  assert.equal(git(task.repo, ['ls-remote', '--heads', 'origin', `refs/heads/${task.branch}`]), '');
});
