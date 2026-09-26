import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveFeatureProgress } from './approval-command.mjs';
import { runCcNexsCommand } from './cc-nexs-cli.mjs';
import { assertHotfixScopeCurrent } from './hotfix-contract.mjs';
import { readProgressV2, recordLocalVerification, writeProgressV2 } from './progress-v2.mjs';

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-bug-init-'));
  for (const repo of ['all-docs', 'api']) {
    const remote = join(root, `${repo}.git`), local = join(root, repo);
    git(root, 'init', '--bare', remote);
    mkdirSync(local);
    git(local, 'init', '-b', 'main');
    git(local, 'config', 'user.name', 'Test User');
    git(local, 'config', 'user.email', 'test@example.com');
    writeFileSync(join(local, 'README.md'), 'baseline\n');
    if (repo === 'all-docs') {
      mkdirSync(join(local, 'doc', '09.existing'), { recursive: true });
      writeFileSync(join(local, 'doc', '09.existing', 'README.md'), 'Existing requirement\n');
    }
    git(local, 'add', '.'); git(local, 'commit', '-m', 'baseline');
    git(local, 'remote', 'add', 'origin', remote); git(local, 'push', 'origin', 'main');
  }
  mkdirSync(join(root, '.cc-nexs'));
  writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), 'version: 1\ndocs_repository: docs\nrepositories:\n  - id: docs\n    path: all-docs\n    docs: true\n    base_branch: main\n  - id: api\n    path: api\n    base_branch: main\n    test_branch: test\n');
  return root;
}

function init(root, extra = []) { return runCcNexsCommand(['init-hotfix', 'repair', '--bug-key', '20260926-repair', '--description', 'Repair the existing failure', '--repos', 'api', ...extra], { cwd: root }); }

function fillScope(file) {
  let text = readFileSync(file, 'utf8').replace('intended_paths: -', 'intended_paths: api/README.md');
  const end = text.indexOf('<!-- HOTFIX-SCOPE END -->');
  const startTable = text.indexOf('| Check |');
  if (startTable !== -1 && startTable < end) text = text.slice(0, startTable) + '| Check | 命令/Driver |\n|---|---|\n| BUG-repro | node --check repair.js |\n\n' + text.slice(end);
  else text = text.replace('<!-- HOTFIX-SCOPE END -->', '| Check | 命令/Driver |\n|---|---|\n| BUG-repro | node --check repair.js |\n<!-- HOTFIX-SCOPE END -->');
  writeFileSync(file, text);
}

test('Hotfix CLI creates hotfix branches and one BUG document without reserving or pushing a feature number', () => {
  const root = fixture();
  try {
    const before = git(join(root, 'all-docs.git'), 'rev-parse', 'main');
    const result = init(root);
    assert.equal(result.reserved, false);
    assert.equal(git(join(root, 'all-docs.git'), 'rev-parse', 'main'), before);
    assert.equal(existsSync(join(root, '.cc-nexs', 'reservations')), false);
    assert.ok(result.document.endsWith('hotfix/20260926-repair/BUG-001.md'));
    assert.ok(existsSync(join(root, '.cc-nexs', 'hotfixes', result.feature.id, 'progress.md')));
    for (const assignment of result.assignments) assert.equal(git(assignment.worktree, 'branch', '--show-current'), 'hotfix/20260926-repair');
    assert.equal(resolveFeatureProgress({ cwd: root, featureId: result.feature.id }), result.progressFile);
    assert.equal(init(root).document, result.document);
    assert.throws(() => runCcNexsCommand(['start-hotfix', result.feature.id], { cwd: root }), /intended_paths|matrix/);
    fillScope(result.document);
    const started = runCcNexsCommand(['start-hotfix', result.feature.id], { cwd: root });
    assert.equal(started.hotfix.review_required, true);
    assert.equal(started.state, 'HOTFIX_IMPLEMENTING');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Hotfix related BUG uses existing requirements and failed initialization can be retried', () => {
  const root = fixture();
  try {
    assert.throws(() => init(root, ['--related', '999']), /related feature/);
    assert.equal(existsSync(join(root, '.worktrees', '20260926-repair', 'api')), false);
    const result = init(root, ['--related', '09']);
    assert.ok(result.document.endsWith('doc/09.existing/bugs/BUG-20260926-repair.md'));
    assert.equal(git(join(root, 'all-docs.git'), 'ls-tree', '--name-only', 'main:doc'), '09.existing');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Hotfix initialization rejects symlink and traversal writes without leaving branches', () => {
  const root = fixture();
  try {
    const external = join(root, 'external'); mkdirSync(external);
    symlinkSync(external, join(root, 'all-docs', 'linked'));
    git(join(root, 'all-docs'), 'add', 'linked'); git(join(root, 'all-docs'), 'commit', '-m', 'linked fixture'); git(join(root, 'all-docs'), 'push', 'origin', 'main');
    assert.throws(() => init(root, ['--bug-file', '../escape.md']), /safe docs-relative/);
    assert.throws(() => init(root, ['--bug-file', 'linked/escape.md']), /symbolic links/);
    assert.equal(existsSync(join(external, 'escape.md')), false);
    assert.equal(git(join(root, 'api'), 'branch', '--list', 'hotfix/*'), '');
    assert.ok(init(root).document.endsWith('BUG-001.md'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('authorized Hotfix revision and Lean promotion retain identity and branches while invalidating evidence', (t) => {
  const root = fixture();
  try {
    const result = init(root); fillScope(result.document);
    runCcNexsCommand(['start-hotfix', result.feature.id], { cwd: root });
    recordLocalVerification(result.progressFile, { source: { api: 'candidate' }, status: 'passed', evidence: [{ check: 'BUG-repro', result: 'passed', command: 'node --check repair.js', exit_code: 0, proof: 'check.log' }] });
    let progress = readProgressV2(result.progressFile);
    progress.gates.release = { approved: true, binding: { source: { api: 'candidate' } } };
    writeProgressV2(result.progressFile, progress);
    writeFileSync(result.document, readFileSync(result.document, 'utf8').replace('api/README.md', 'api/README.md, api/repair.js'));
    assert.throws(() => assertHotfixScopeCurrent(progress, join(root, '.cc-nexs', 'hotfixes', result.feature.id)), /scope changed/);
    assert.throws(() => runCcNexsCommand(['revise-hotfix', result.feature.id, '--reason', 'same bug'], { cwd: root }), /authorization/);
    const args = ['revise-hotfix', result.feature.id, '--reason', 'Repair the same failure through its shared caller', '--authorization-evidence', 'User requested this root-cause repair'];
    for (const status of ['running', 'deploying']) {
      progress.delivery.test.status = status;
      progress.delivery.test.attempts = [{ id: 'release-old', status, source: { api: 'candidate' } }];
      writeProgressV2(result.progressFile, progress);
      assert.throws(() => runCcNexsCommand(args, { cwd: root }), /active test release/);
    }
    progress.delivery.test.status = 'verified';
    progress.delivery.test.attempts[0].status = 'verified';
    writeProgressV2(result.progressFile, progress);
    runCcNexsCommand(args, { cwd: root });
    progress = readProgressV2(result.progressFile);
    assert.ok(progress.delivery.test.attempts[0].invalidated_at);
    assert.equal(progress.delivery.test.attempts[0].status, 'verified');
    assert.equal(progress.local_verification.status, 'idle');
    assert.equal(progress.local_verification.attempts.length, 1);
    assert.equal(progress.gates.release.approved, false);
    assert.equal(progress.events.at(-1).data.previous.gates.release.approved, true);
    const rename = fs.renameSync;
    const fault = t.mock.method(fs, 'renameSync', (from, to) => {
      if (to.endsWith('progress.hotfix-history.json')) throw new Error('simulated archive failure');
      return rename(from, to);
    });
    try {
      syncBuiltinESMExports();
      assert.throws(() => runCcNexsCommand([...args, '--promote-lean'], { cwd: root }), /simulated archive failure/);
      assert.ok(existsSync(result.progressFile));
      assert.ok(existsSync(result.progressFile.replace('progress.json', 'progress.md')));
      assert.equal(existsSync(result.document.replace(/\.md$/, '.lean')), false);
    } finally { fault.mock.restore(); syncBuiltinESMExports(); }
    const promoted = runCcNexsCommand([...args, '--promote-lean'], { cwd: root });
    assert.equal(promoted.mode, 'lean');
    assert.equal(promoted.state, 'PLANNING');
    assert.equal(realpathSync(resolveFeatureProgress({ cwd: root, featureId: result.feature.id })), realpathSync(promoted.progressFile));
    assert.equal(readProgressV2(promoted.progressFile).feature.id, result.feature.id);
    for (const assignment of result.assignments) assert.equal(git(assignment.worktree, 'branch', '--show-current'), 'hotfix/20260926-repair');
    assert.ok(existsSync(promoted.progressFile.replace('progress.json', 'requirements.md')));
    assert.equal(existsSync(result.progressFile), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
