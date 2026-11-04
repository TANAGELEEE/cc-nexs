import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { inspectEgoLite } from './pi-browser-provider.mjs';
import { parseCredentialRef, resolveBrowserProvider, resolveCredential, testAccount } from './test-session.mjs';

const egoReady = (command, args) => {
  if (command === 'ego-browser') return 'ego-browser ready\n';
  throw new Error(`unexpected ${command} ${args.join(' ')}`);
};
const egoMissing = () => { throw new Error('ego-browser: command not found'); };

test('Claude prefers ego lite and falls back to chrome-devtools-mcp; Codex keeps its browser session', () => {
  assert.deepEqual(resolveBrowserProvider({ runtime: 'claude', execFile: egoReady }), { runtime: 'claude', provider: 'ego-lite', fallback: false });
  const fallback = resolveBrowserProvider({ runtime: 'claude', execFile: egoMissing });
  assert.equal(fallback.provider, 'chrome-devtools-mcp');
  assert.equal(fallback.fallback, true);
  assert.deepEqual(resolveBrowserProvider({ runtime: 'claude', browser: { claude_provider: 'chrome-devtools-mcp' }, execFile: egoReady }), { runtime: 'claude', provider: 'chrome-devtools-mcp', fallback: false });
  assert.equal(resolveBrowserProvider({ runtime: 'codex' }).provider, 'current-browser-session');
  assert.equal(resolveBrowserProvider({ runtime: 'pi', execFile: egoReady }).provider, 'ego-lite');
  const silent = () => '';
  assert.equal(inspectEgoLite({ execFile: silent, spawn: () => ({ status: 0, stdout: '', stderr: 'ego-browser ready\n' }) }).ready, true, 'stderr output without a terminal still proves ego lite');
  assert.equal(inspectEgoLite({ execFile: silent, spawn: () => ({ status: 0, stdout: '', stderr: '' }) }).ready, false);
  assert.throws(() => resolveBrowserProvider({ runtime: 'cursor' }), /must be claude, codex, or pi/);
});

test('credential_ref accepts only opaque env, dotenv, and keychain references', () => {
  assert.deepEqual(parseCredentialRef('env:SMOKE_USER,SMOKE_PASS'), { scheme: 'env', userVar: 'SMOKE_USER', passwordVar: 'SMOKE_PASS' });
  assert.deepEqual(parseCredentialRef('dotenv:e2e/.env#A,B'), { scheme: 'dotenv', path: 'e2e/.env', userVar: 'A', passwordVar: 'B' });
  assert.deepEqual(parseCredentialRef('keychain://cc-nexs/test-console'), { scheme: 'keychain', service: 'cc-nexs', account: 'test-console' });
  assert.throws(() => parseCredentialRef('someone@example.com:hunter2'), /must start with env:, dotenv:, or keychain:/);
  assert.throws(() => parseCredentialRef('env:ONLY_ONE'), /user variable and a password variable/);
  assert.throws(() => parseCredentialRef('dotenv:e2e/.env'), /dotenv:<path>#/);
});

test('credentials resolve from the environment, an untracked env file, or the Keychain', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-credential-'));
  try {
    assert.deepEqual(resolveCredential({ ref: 'env:U,P', workspaceRoot: root, env: { U: 'user@test', P: 'secret' } }), { source: 'environment', user: 'user@test', password: 'secret' });
    mkdirSync(join(root, 'e2e'));
    writeFileSync(join(root, 'e2e', '.env'), '# comment\nexport U="file-user"\nP=\'file-pass\'\n');
    assert.deepEqual(resolveCredential({ ref: 'dotenv:e2e/.env#U,P', workspaceRoot: root, env: {} }), { source: 'dotenv e2e/.env', user: 'file-user', password: 'file-pass' });
    assert.equal(resolveCredential({ ref: 'dotenv:e2e/.env#U,P', workspaceRoot: root, env: { P: 'env-pass' } }).password, 'env-pass');
    assert.deepEqual(resolveCredential({ ref: 'dotenv:missing/.env#U,P', workspaceRoot: root, env: {} }), { source: 'dotenv missing/.env (missing)', user: '', password: '' });

    execFileSync('git', ['-C', join(root, 'e2e'), 'init', '-q']);
    execFileSync('git', ['-C', join(root, 'e2e'), 'add', '.env']);
    assert.throws(() => resolveCredential({ ref: 'dotenv:e2e/.env#U,P', workspaceRoot: root, env: {} }), /tracked by Git/);

    const keychain = (command, args) => {
      assert.equal(command, 'security');
      assert.deepEqual(args, ['find-generic-password', '-s', 'cc-nexs', '-a', 'qa@test', '-w']);
      return 'kc-pass\n';
    };
    assert.deepEqual(resolveCredential({ ref: 'keychain:cc-nexs/qa@test', workspaceRoot: root, execFile: keychain }), { source: 'keychain cc-nexs/qa@test', user: 'qa@test', password: 'kc-pass' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('test-account reports readiness without values and hands them only to a child process', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-test-account-'));
  try {
    mkdirSync(join(root, '.cc-nexs'), { recursive: true });
    writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), 'version: 1\nrepositories:\n  - id: web\n    path: web\n');
    mkdirSync(join(root, 'web'));
    writeFileSync(join(root, 'cc-nexs.config.json'), '{}\n');
    assert.equal(testAccount({ cwd: root }).configured, false);

    writeFileSync(join(root, 'cc-nexs.config.json'), JSON.stringify({ release: { test: { credential_ref: 'env:QA_USER,QA_PASS' } } }));
    const missing = testAccount({ cwd: root, env: { QA_USER: 'qa@test' } });
    assert.deepEqual({ ready: missing.ready, user: missing.user, password: missing.password }, { ready: false, user: 'present', password: 'missing' });
    assert.throws(() => testAccount({ cwd: root, env: { QA_USER: 'qa@test' }, command: ['node', 'login.mjs'] }), /incomplete; nothing was run/);

    const ready = testAccount({ cwd: root, env: { QA_USER: 'qa@test', QA_PASS: 'pw' } });
    assert.ok(!JSON.stringify(ready).includes('qa@test') && !JSON.stringify(ready).includes('"pw"'));
    let seen;
    const spawn = (command, args, options) => { seen = { command, args, user: options.env.CC_NEXS_TEST_USER, password: options.env.CC_NEXS_TEST_PASSWORD }; return { status: 0 }; };
    const ran = testAccount({ cwd: root, env: { QA_USER: 'qa@test', QA_PASS: 'pw' }, command: ['node', 'login.mjs'], spawn });
    assert.deepEqual(seen, { command: 'node', args: ['login.mjs'], user: 'qa@test', password: 'pw' });
    assert.equal(ran.ran, 'node');
    assert.throws(() => testAccount({ cwd: root, env: { QA_USER: 'qa@test', QA_PASS: 'pw' }, command: ['node'], spawn: () => ({ status: 3 }) }), /exited with 3/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
