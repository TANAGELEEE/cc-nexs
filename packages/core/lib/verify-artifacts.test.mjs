import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCcNexsCommand } from './cc-nexs-cli.mjs';
import { runLocalVerification } from './local-verify.mjs';
import { planApprovalBinding } from './plan-contract.mjs';
import { createProgressV2, readProgressV2, writeProgressV2 } from './progress-v2.mjs';
import { beginVerifyAttempt, classifyVerifyArtifacts, finishVerifyAttempt, lowVolumes, minFreeGb } from './verify-artifacts.mjs';
import { inventoryWorktrees, reclaimWorktrees } from './worktree-reclaim.mjs';

const lib = dirname(fileURLToPath(import.meta.url));
const GB = 1024 ** 3;
const passing = { check: 'LV-001', result: 'passed', command: 'git show HEAD:app.txt', exit_code: 0, proof: 'ready' };

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// The driver body runs with `payload`, `fs` and `path` in scope and returns the JSON result.
function fixture(driverBody, localVerify = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-verify-artifacts-'));
  const api = join(root, 'api');
  const docs = join(root, 'docs', 'doc', '31.verify-artifacts');
  const driver = join(root, 'driver.mjs');
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  mkdirSync(api, { recursive: true });
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), [
    'version: 1',
    'docs_repository: docs',
    'repositories:',
    '  - id: docs',
    '    path: docs',
    '    docs: true',
    '  - id: api',
    '    path: api',
    '    base_branch: main',
    '    test_branch: test',
  ].join('\n'));
  writeFileSync(driver, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "const payload = JSON.parse(fs.readFileSync(0, 'utf8'));",
    `const passing = ${JSON.stringify(passing)};`,
    `process.stdout.write(JSON.stringify((() => { ${driverBody} })()));`,
  ].join('\n'));
  writeFileSync(join(root, 'cc-nexs.config.json'), JSON.stringify({
    workflow: { local_verify: { min_free_gb: 0, driver: { command: process.execPath, args: [driver], timeout_seconds: 30 }, ...localVerify } },
  }));
  git(api, ['init', '-b', 'feature/31-verify-artifacts']);
  git(api, ['config', 'user.name', 'Test User']);
  git(api, ['config', 'user.email', 'test@example.com']);
  writeFileSync(join(api, 'app.txt'), 'ready\n');
  git(api, ['add', 'app.txt']);
  git(api, ['commit', '-m', 'initial']);
  const commit = git(api, ['rev-parse', 'HEAD']);
  const candidateRef = 'refs/cc-nexs/candidates/31-verify-artifacts/api';
  git(api, ['update-ref', candidateRef, commit]);
  writeFileSync(join(docs, 'requirements.md'), '# Requirements\n\n- AC-001\n');
  writeFileSync(join(docs, 'plan.md'), [
    '# Plan',
    '<!-- APPROVAL-SCOPE START -->',
    '- T-001',
    '| Check | AC | 类型 | 命令/Driver | 通过条件 |',
    '|---|---|---|---|---|',
    '| LV-001 | AC-001 | smoke | git show HEAD:app.txt | ready |',
    '<!-- APPROVAL-SCOPE END -->',
    '',
  ].join('\n'));
  writeFileSync(join(docs, 'progress.md'), '## 当前状态\n\n```yaml\ncurrent_state: IMPLEMENTING\nupdated_at: null\n```\n\n## 历史轨迹\n\n- (尚无)\n');
  const progress = createProgressV2({ featureId: '31', featureSlug: 'verify-artifacts', preset: 'preset-standard' });
  progress.state = 'IMPLEMENTING';
  progress.gates.plan = { approved: true, binding: planApprovalBinding(docs) };
  progress.repositories.api = { branch: 'feature/31-verify-artifacts', worktree: 'api', candidate: { commit, ref: candidateRef, paths: ['app.txt'] } };
  const progressFile = join(docs, 'progress.json');
  writeProgressV2(progressFile, progress);
  const attemptDir = (id = '1') => join(root, '.cc-nexs', 'runtime', 'verify', '31', id);
  const receipt = (id = '1') => JSON.parse(readFileSync(join(attemptDir(id), 'receipt.json'), 'utf8'));
  const verify = (options = {}) => runLocalVerification({ cwd: root, featureId: '31', progressPath: progressFile, ...options });
  return { root, api, progressFile, attemptDir, receipt, verify, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const writesScratch = `
  fs.writeFileSync(path.join(payload.scratch_dir, 'build.bin'), 'x'.repeat(4096));
  fs.writeFileSync(path.join(payload.artifacts_dir, 'report.txt'), 'kept');
`;

test('a passing attempt removes scratch and keeps logs, hashes, artifacts and evidence', () => {
  const env = fixture(`${writesScratch} console.error('driver note'); return { status: 'passed', evidence: [passing] };`);
  try {
    const result = env.verify();
    assert.equal(result.status, 'passed');
    assert.equal(result.attemptDir, env.attemptDir());
    assert.equal(existsSync(join(env.attemptDir(), 'scratch')), false);
    assert.equal(readFileSync(join(env.attemptDir(), 'artifacts', 'report.txt'), 'utf8'), 'kept');
    const receipt = env.receipt();
    assert.equal(receipt.status, 'passed');
    assert.equal(receipt.scratch, 'removed');
    assert.deepEqual(receipt.source, result.source);
    const stderr = readFileSync(join(env.attemptDir(), 'driver.stderr.log'), 'utf8');
    assert.match(stderr, /driver note/);
    assert.equal(receipt.logs.stderr.sha256, createHash('sha256').update(stderr).digest('hex'));
    assert.ok(receipt.logs.stdout.sha256);
    assert.equal(readProgressV2(env.progressFile).local_verification.attempts.at(-1).evidence[0].proof, 'ready');
    assert.equal(git(env.api, ['status', '--porcelain']), '');
  } finally { env.cleanup(); }
});

test('failing attempts remove scratch and keep the only record of the failure', () => {
  const env = fixture(`${writesScratch}
    if (!fs.existsSync(path.join(path.dirname(payload.scratch_dir), '..', 'recorded'))) {
      fs.writeFileSync(path.join(path.dirname(payload.scratch_dir), '..', 'recorded'), '');
      console.error('compile exploded');
      process.exit(3);
    }
    fs.writeFileSync(path.join(payload.repositories.api.worktree, 'stray.txt'), 'dirty');
    return { status: 'passed', evidence: [passing] };`);
  try {
    assert.throws(() => env.verify(), /driver failed: compile exploded/);
    assert.equal(existsSync(join(env.attemptDir('1'), 'scratch')), false);
    assert.equal(env.receipt('1').status, 'error');
    assert.match(env.receipt('1').error, /compile exploded/);
    assert.match(readFileSync(join(env.attemptDir('1'), 'driver.stderr.log'), 'utf8'), /compile exploded/);
    assert.equal(readFileSync(join(env.attemptDir('1'), 'artifacts', 'report.txt'), 'utf8'), 'kept');

    // A driver that dirties the candidate is rejected after it returns; the next attempt gets its own directory.
    assert.throws(() => env.verify(), /must be clean at exact candidate/);
    assert.equal(existsSync(join(env.attemptDir('2'), 'scratch')), false);
    assert.equal(env.receipt('2').status, 'error');
    assert.equal(readProgressV2(env.progressFile).local_verification?.attempts?.length || 0, 0);
  } finally { env.cleanup(); }
});

test('a recorded failed result still removes scratch', () => {
  const failed = { check: 'LV-001', result: 'failed', command: passing.command, exit_code: 1, proof: 'smoke failed' };
  const env = fixture(`${writesScratch} return { status: 'failed', evidence: [${JSON.stringify(failed)}] };`);
  try {
    assert.equal(env.verify().status, 'failed');
    assert.equal(existsSync(join(env.attemptDir(), 'scratch')), false);
    assert.equal(env.receipt().status, 'failed');
    assert.equal(readProgressV2(env.progressFile).local_verification.status, 'failed');
  } finally { env.cleanup(); }
});

test('scratch stays when it holds the only evidence or dirty source', () => {
  const namesScratch = fixture(`${writesScratch}
    return { status: 'passed', evidence: [{ ...passing, proof: 'see ' + path.join(payload.scratch_dir, 'build.bin') }] };`);
  try {
    namesScratch.verify();
    assert.ok(existsSync(join(namesScratch.attemptDir(), 'scratch', 'build.bin')));
    assert.equal(namesScratch.receipt().scratch, 'retained');
    assert.match(namesScratch.receipt().scratch_reason, /evidence references scratch_dir/);
  } finally { namesScratch.cleanup(); }

  const dirty = fixture(`
    const checkout = path.join(payload.scratch_dir, 'export');
    fs.mkdirSync(checkout);
    execFileSync('git', ['init'], { cwd: checkout, stdio: 'ignore' });
    fs.writeFileSync(path.join(checkout, 'edit.txt'), 'not committed');
    return { status: 'passed', evidence: [passing] };`);
  try {
    const driver = join(dirty.root, 'driver.mjs');
    writeFileSync(driver, `import { execFileSync } from 'node:child_process';\n${readFileSync(driver, 'utf8')}`);
    dirty.verify();
    assert.ok(existsSync(join(dirty.attemptDir(), 'scratch', 'export', 'edit.txt')));
    assert.match(dirty.receipt().scratch_reason, /uncommitted source/);
    assert.equal(classifyVerifyArtifacts({ root: dirty.root, tasks: { byFeature: new Map() } })[0].action, 'keep');
  } finally { dirty.cleanup(); }
});

function reclaimWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-verify-reclaim-'));
  mkdirSync(join(root, '.cc-nexs', 'hotfixes'), { recursive: true });
  mkdirSync(join(root, 'code'));
  git(join(root, 'code'), ['init', '-b', 'master']);
  writeFileSync(join(root, '.cc-nexs', 'workspace.json'), `${JSON.stringify({
    version: 1, repositories: [{ id: 'code', path: 'code', base_branch: 'master', test_branch: 'test' }],
  })}\n`);
  const task = (key, state) => {
    const record = createProgressV2({ featureId: key, featureSlug: key, preset: 'preset-standard', mode: 'hotfix' });
    record.state = state;
    mkdirSync(join(root, '.cc-nexs', 'hotfixes', key), { recursive: true });
    writeProgressV2(join(root, '.cc-nexs', 'hotfixes', key, 'progress.json'), record);
  };
  const attempt = (key, { end = 'failed', scratch = true } = {}) => {
    const started = beginVerifyAttempt({ root, taskId: key, source: { code: 'abc' }, fingerprint: 'fp', timeoutMs: 60_000 });
    writeFileSync(join(started.dir, 'driver.stdout.log'), '{}');
    writeFileSync(join(started.scratchDir, 'build.bin'), 'x'.repeat(2048));
    if (end) finishVerifyAttempt(started, { status: end });
    if (end && scratch) { mkdirSync(started.scratchDir, { recursive: true }); writeFileSync(join(started.scratchDir, 'leftover.bin'), 'x'); }
    return started;
  };
  return { root, task, attempt };
}

const entryFor = (inventory, suffix) => inventory.entries.find((entry) => entry.display.replaceAll('\\', '/').endsWith(suffix));

test('inventory keeps running attempts and reclaims inactive ones through the token', () => {
  const { root, task, attempt } = reclaimWorkspace();
  try {
    task('h-active', 'HOTFIX_IMPLEMENTING');
    task('h-done', 'COMPLETE');
    const crashed = attempt('h-active', { end: null });
    writeFileSync(join(crashed.dir, 'receipt.json'), JSON.stringify({ ...crashed.receipt, pid: 2 ** 22 + 1 }));
    const finished = attempt('h-active', { scratch: false });
    const running = attempt('h-active', { end: null });
    const completed = attempt('h-done', { scratch: false });
    const orphan = attempt('h-unknown', { scratch: false });
    const orphanScratch = attempt('h-unknown');
    const expired = attempt('h-done', { end: null });
    writeFileSync(join(expired.dir, 'receipt.json'), JSON.stringify({ ...expired.receipt, deadline_at: '2020-01-01T00:00:00.000Z' }));
    const unreceipted = join(root, '.cc-nexs', 'runtime', 'verify', 'h-active', '9');
    mkdirSync(join(unreceipted, 'scratch'), { recursive: true });

    const inventory = inventoryWorktrees({ cwd: root, sizes: true });
    assert.equal(entryFor(inventory, 'h-active/1/scratch').kind, 'verify-scratch');
    assert.equal(entryFor(inventory, 'h-active/1/scratch').action, 'reclaim');
    assert.match(entryFor(inventory, 'h-active/2').reason, /active task h-active .*logs retained/);
    assert.equal(entryFor(inventory, 'h-active/2').action, 'keep');
    assert.equal(entryFor(inventory, 'h-active/3').action, 'keep');
    assert.match(entryFor(inventory, 'h-active/3').reason, /attempt running/);
    assert.match(entryFor(inventory, 'h-active/9').reason, /no attempt receipt/);
    assert.equal(entryFor(inventory, 'h-done/1').kind, 'verify-attempt');
    assert.equal(entryFor(inventory, 'h-done/1').action, 'reclaim');
    assert.equal(entryFor(inventory, 'h-done/2').action, 'reclaim');
    assert.match(entryFor(inventory, 'h-unknown/1').reason, /no task state found/);
    assert.equal(entryFor(inventory, 'h-unknown/2/scratch').action, 'reclaim');

    assert.throws(() => reclaimWorktrees({ cwd: root, confirm: 'wrongtoken00' }), /reclaim plan changed/);
    assert.ok(existsSync(crashed.scratchDir));

    const result = reclaimWorktrees({ cwd: root, confirm: inventory.token });
    assert.equal(result.failed.length, 0);
    assert.equal(existsSync(crashed.scratchDir), false);
    assert.ok(existsSync(join(crashed.dir, 'driver.stdout.log')));
    assert.ok(existsSync(join(finished.dir, 'receipt.json')));
    assert.ok(existsSync(running.scratchDir));
    assert.ok(existsSync(join(running.scratchDir, 'build.bin')));
    assert.equal(existsSync(completed.dir), false);
    assert.equal(existsSync(join(root, '.cc-nexs', 'runtime', 'verify', 'h-done')), false);
    assert.ok(existsSync(join(orphan.dir, 'receipt.json')));
    assert.equal(existsSync(orphanScratch.scratchDir), false);
    assert.ok(existsSync(unreceipted));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('only the latest evidence of an unfinished task pins its scratch', () => {
  const { root, task, attempt } = reclaimWorkspace();
  try {
    task('h-active', 'HOTFIX_IMPLEMENTING');
    const retained = (key) => {
      const started = attempt(key, { end: null });
      started.stdout = `proof at ${started.scratchDir}/report.html`;
      finishVerifyAttempt(started, { status: 'passed' });
      return started;
    };
    retained('h-active');
    assert.equal(entryFor(inventoryWorktrees({ cwd: root }), 'h-active/1').action, 'keep');
    retained('h-active');
    const inventory = inventoryWorktrees({ cwd: root });
    assert.equal(entryFor(inventory, 'h-active/1/scratch').action, 'reclaim');
    assert.equal(entryFor(inventory, 'h-active/2').action, 'keep');
    assert.match(entryFor(inventory, 'h-active/2').reason, /latest evidence/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('low disk reclaims inactive scratch once before the driver runs', () => {
  const env = fixture(`${writesScratch} return { status: 'passed', evidence: [passing] };`, { min_free_gb: 5 });
  try {
    const stale = beginVerifyAttempt({ root: env.root, taskId: '31', source: {}, fingerprint: 'fp', timeoutMs: 1000 });
    writeFileSync(join(stale.dir, 'receipt.json'), JSON.stringify({ ...stale.receipt, pid: 2 ** 22 + 1 }));
    writeFileSync(join(stale.scratchDir, 'export.bin'), 'x');
    const running = beginVerifyAttempt({ root: env.root, taskId: '31', source: {}, fingerprint: 'fp', timeoutMs: 60_000 });
    writeFileSync(join(running.scratchDir, 'in-use.bin'), 'x');

    const probes = [];
    const freeBytes = (path) => { probes.push(path); return existsSync(stale.scratchDir) ? GB : 20 * GB; };
    assert.equal(env.verify({ freeBytes }).status, 'passed');
    assert.equal(existsSync(stale.scratchDir), false);
    assert.ok(existsSync(join(running.scratchDir, 'in-use.bin')));
    assert.ok(existsSync(env.attemptDir('3')));
    assert.equal(probes.length, 2);
  } finally { env.cleanup(); }
});

test('low disk stops with a blocker and leaves state, attempts and active work alone', () => {
  const env = fixture(`fs.writeFileSync(path.join(path.dirname(payload.scratch_dir), '..', '..', 'driver-ran'), ''); return { status: 'passed', evidence: [passing] };`, { min_free_gb: 5 });
  try {
    const running = beginVerifyAttempt({ root: env.root, taskId: '31', source: {}, fingerprint: 'fp', timeoutMs: 60_000 });
    writeFileSync(join(running.scratchDir, 'in-use.bin'), 'x');
    const before = readProgressV2(env.progressFile);
    let probes = 0;
    assert.throws(
      () => env.verify({ freeBytes: () => { probes += 1; return 2 * GB; } }),
      /blocked by low disk space: .* has 2\.0 GB free; workflow\.local_verify\.min_free_gb requires 5 GB after reclaiming 0 inactive/,
    );
    assert.equal(probes, 2);
    assert.deepEqual(readdirSync(join(env.root, '.cc-nexs', 'runtime', 'verify', '31')), ['1']);
    assert.ok(existsSync(join(running.scratchDir, 'in-use.bin')));
    assert.equal(existsSync(join(env.root, '.cc-nexs', 'runtime', 'verify', 'driver-ran')), false);
    assert.deepEqual(readProgressV2(env.progressFile), before);
  } finally { env.cleanup(); }
});

test('preflight covers the direct-evidence path and records nothing', () => {
  const env = fixture('return {};', { min_free_gb: 5, driver: null });
  try {
    const before = readProgressV2(env.progressFile);
    const healthy = env.verify({ preflightOnly: true, freeBytes: () => 20 * GB });
    assert.equal(healthy.kind, 'local-verification-preflight');
    assert.deepEqual(healthy.disk, { min_free_gb: 5, reclaimed: [] });
    assert.throws(() => env.verify({ preflightOnly: true, freeBytes: () => GB }), /blocked by low disk space/);
    assert.deepEqual(readProgressV2(env.progressFile), before);
    assert.throws(() => runCcNexsCommand(['verify-local', '31', '--preflight', '--passed'], { cwd: env.root }), /--preflight cannot record evidence/);
    assert.equal(runCcNexsCommand(['verify-local', '31', '--preflight', '--progress', env.progressFile], { cwd: env.root }).kind, 'local-verification-preflight');
  } finally { env.cleanup(); }
});

test('threshold parsing and volume measurement', () => {
  assert.equal(minFreeGb(undefined), 10);
  assert.equal(minFreeGb({ min_free_gb: 0 }), 0);
  for (const invalid of [-1, 'lots', Number.POSITIVE_INFINITY]) {
    assert.throws(() => minFreeGb({ min_free_gb: invalid }), /non-negative number/);
  }
  const probed = [];
  const low = lowVolumes({ paths: [lib, join(lib, '..')], thresholdGb: 1, freeBytes: (path) => { probed.push(path); return 0; } });
  assert.deepEqual(probed, [lib]);
  assert.deepEqual(low, [{ path: lib, freeBytes: 0 }]);
  assert.deepEqual(lowVolumes({ paths: [lib], thresholdGb: 0, freeBytes: () => 0 }), []);
});

test('doctor lists verify artifacts in the worktree inventory', () => {
  const { root, task, attempt } = reclaimWorkspace();
  try {
    task('h-done', 'COMPLETE');
    attempt('h-done', { scratch: false });
    const doctor = spawnSync(process.execPath, [join(lib, 'doctor.mjs'), root, '--worktrees', '--sizes'], { encoding: 'utf8' });
    assert.match(doctor.stdout, /RECLAIM verify-attempt\s+\.cc-nexs\/runtime\/verify\/h-done\/1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('idle scratch, unmanaged directories and clean orphan worktrees are reclaimed; recent or dirty ones stay', () => {
  const { root, task } = reclaimWorkspace();
  const age = (path, days) => { const at = new Date(Date.now() - days * 86400000); utimesSync(path, at, at); };
  const make = (path, days) => { mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'f.bin'), 'x'); age(join(path, 'f.bin'), days); age(path, days); };
  try {
    task('h-active', 'HOTFIX_IMPLEMENTING');
    task('h-done', 'COMPLETE');
    const nexs = join(root, '.cc-nexs');
    make(join(nexs, 'runtime', 'tasks', 'h-active', 'scratch'), 3);
    writeFileSync(join(nexs, 'runtime', 'tasks', 'h-active', 'request.json'), '{}');
    make(join(nexs, 'runtime', 'h-active-isolated'), 9);
    make(join(nexs, 'runtime', 'h-active-fresh'), 0);
    make(join(nexs, 'runtime', 'heavy'), 30);
    make(join(nexs, 'h-done-evidence'), 0);
    make(join(nexs, 'notes'), 40);
    make(join(nexs, 'drivers'), 40);

    const code = join(root, 'code');
    writeFileSync(join(code, 'app.txt'), 'one\n');
    git(code, ['add', '.']);
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'init'], { cwd: code, env: { ...process.env, GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' } });
    const wt = (key, name, branch) => { git(code, ['worktree', 'add', '-q', '-b', branch, join(root, '.worktrees', key, name)]); return join(root, '.worktrees', key, name); };
    const idle = wt('scratch-old', 'code', 'scratch/old');
    const dirty = wt('scratch-dirty', 'code', 'scratch/dirty');
    const recent = wt('scratch-new', 'code', 'scratch/new');
    writeFileSync(join(dirty, 'edit.txt'), 'x');
    for (const path of [idle, dirty]) { for (const name of readdirSync(path)) age(join(path, name), 10); age(path, 10); }
    git(recent, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'now']);

    const inventory = inventoryWorktrees({ cwd: root });
    const of = (suffix) => entryFor(inventory, suffix);
    assert.equal(of('tasks/h-active/scratch').kind, 'task-scratch');
    assert.equal(of('tasks/h-active/scratch').action, 'reclaim');
    assert.equal(of('tasks/h-active').action, 'keep');
    assert.match(of('runtime/h-active-isolated').reason, /runtime files idle 9 days/);
    assert.equal(of('runtime/h-active-isolated').action, 'reclaim');
    assert.equal(of('runtime/h-active-fresh').action, 'keep');
    assert.equal(of('runtime/heavy'), undefined, 'managed directories are never listed as unmanaged');
    assert.equal(of('.cc-nexs/drivers'), undefined);
    assert.match(of('.cc-nexs/h-done-evidence').reason, /task h-done complete/);
    assert.equal(of('.cc-nexs/h-done-evidence').action, 'reclaim');
    assert.equal(of('.cc-nexs/notes').action, 'keep', 'an unknown directory outside runtime is only reported');
    assert.equal(of('scratch-old/code').kind, 'idle-worktree', of('scratch-old/code').reason);
    assert.match(of('scratch-old/code').reason, /branch scratch\/old is kept/);
    assert.match(of('scratch-dirty/code').reason, /uncommitted or untracked/);
    assert.match(of('scratch-new/code').reason, /clean, idle 0 days/);

    const result = reclaimWorktrees({ cwd: root, confirm: inventory.token });
    assert.deepEqual(result.failed, []);
    assert.equal(existsSync(idle), false);
    assert.equal(git(code, ['rev-parse', '--verify', 'refs/heads/scratch/old']).length, 40, 'the branch survives');
    assert.ok(existsSync(dirty) && existsSync(recent));
    assert.equal(existsSync(join(nexs, 'runtime', 'tasks', 'h-active', 'scratch')), false);
    assert.ok(existsSync(join(nexs, 'runtime', 'tasks', 'h-active', 'request.json')));
    assert.equal(existsSync(join(nexs, 'runtime', 'h-active-isolated')), false);
    assert.equal(existsSync(join(nexs, 'h-done-evidence')), false);
    assert.ok(existsSync(join(nexs, 'notes')) && existsSync(join(nexs, 'drivers')) && existsSync(join(nexs, 'runtime', 'heavy')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
