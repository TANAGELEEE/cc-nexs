import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCcNexsCommand } from './cc-nexs-cli.mjs';
import { createProgressV2, readProgressV2, writeProgressV2 } from './progress-v2.mjs';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('commit-candidate commits declared paths from the assigned worktree and records the candidate', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-candidate-'));
  try {
    const code = join(root, 'code');
    mkdirSync(code);
    git(code, ['init', '-q', '-b', 'master']);
    git(code, ['config', 'user.name', 'tester']);
    git(code, ['config', 'user.email', 'tester@example.invalid']);
    writeFileSync(join(code, 'app.txt'), 'one\n');
    git(code, ['add', '.']);
    git(code, ['commit', '-q', '-m', 'init']);
    const worktree = join(root, '.worktrees', 'h-1', 'code');
    git(code, ['worktree', 'add', '-q', '-b', 'hotfix/h-1', worktree]);
    const dir = join(root, '.cc-nexs', 'hotfixes', 'h-1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, '.cc-nexs', 'workspace.json'), `${JSON.stringify({ version: 1, repositories: [{ id: 'code', path: 'code', base_branch: 'master' }] })}\n`);
    const progress = createProgressV2({ featureId: 'h-1', featureSlug: 'h-1', preset: 'preset-standard', mode: 'hotfix', repositories: ['code'] });
    progress.repositories.code = { branch: 'hotfix/h-1', worktree: join('.worktrees', 'h-1', 'code'), base_branch: 'master', candidate: null };
    const file = join(dir, 'progress.json');
    writeProgressV2(file, progress);
    writeFileSync(join(worktree, 'app.txt'), 'two\n');
    writeFileSync(join(worktree, 'stray.txt'), 'not declared\n');
    const args = ['commit-candidate', 'h-1', '--progress', file, '--message', 'fix: two'];
    assert.throws(() => runCcNexsCommand([...args, '--path', 'app.txt'], { cwd: root }), /requires --repo/);
    assert.throws(() => runCcNexsCommand([...args, '--repo', 'web', '--path', 'app.txt'], { cwd: root }), /no assigned worktree.*assigned: code/);
    const result = runCcNexsCommand([...args, '--repo', 'code', '--path', 'app.txt'], { cwd: root });
    assert.equal(result.candidateRef, 'refs/cc-nexs/candidates/h-1/code');
    assert.deepEqual(result.staged, ['app.txt']);
    assert.equal(git(code, ['rev-parse', result.candidateRef]), result.commit);
    assert.equal(git(worktree, ['status', '--porcelain']), '?? stray.txt', 'undeclared files stay out of the candidate');
    assert.equal(readProgressV2(file).repositories.code.candidate.ref, result.candidateRef);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
