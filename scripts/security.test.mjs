import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  assertPresetName,
  assertWithin,
  copyTreeNoSymlinks,
  safeRemoveWithin,
} from './lib/safe-fs.mjs';
import { writeJsonAtomic, writeTextAtomic } from './lib/atomic-write.mjs';
import { parseInstallArgs, resolveInstallHome } from './lib/install-home.mjs';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

test('preset names reject traversal, absolute paths, and unregistered shapes', () => {
  assert.equal(assertPresetName('preset-standard'), 'preset-standard');
  for (const value of ['../preset-safe', '/tmp/preset-safe', 'preset_safe', 'core', 'preset-', 'preset-A']) {
    assert.throws(() => assertPresetName(value), /invalid preset name/);
  }
});

test('path containment rejects root deletion and escapes', () => {
  const root = resolve('/tmp/example-root');
  assert.equal(assertWithin(root, join(root, 'child')), join(root, 'child'));
  assert.throws(() => assertWithin(root, root), /escapes allowed root/);
  assert.throws(() => assertWithin(root, join(root, '..', 'outside')), /escapes allowed root/);
  assert.throws(() => safeRemoveWithin(root, root), /escapes allowed root/);
});

test('install home parsing prefers explicit isolated homes', () => {
  const parsed = parseInstallArgs(['preset-standard', '--home', './tmp home', '--skip-marketplace-register']);
  assert.deepEqual(parsed.positional, ['preset-standard']);
  assert.equal(parsed.home, './tmp home');
  assert.equal(parsed.flags.has('--skip-marketplace-register'), true);
  assert.equal(
    resolveInstallHome({ explicitHome: parsed.home, env: { CC_NEXS_INSTALL_HOME: '/ignored' }, defaultHome: '/default' }),
    resolve('./tmp home'),
  );
  assert.equal(
    resolveInstallHome({ env: { CC_NEXS_INSTALL_HOME: './env home' }, defaultHome: '/default' }),
    resolve('./env home'),
  );
  assert.throws(() => parseInstallArgs(['--home']), /requires a path/);
});

test('Codex local installer refuses overlapping preset hooks', () => {
  const isolatedHome = mkdtempSync(join(tmpdir(), 'cc-nexs-codex-all-'));
  try {
    const result = spawnSync(process.execPath, [
      join(REPO_ROOT, 'scripts', 'install-local-codex.mjs'),
      '--all',
      '--home',
      isolatedHome,
      '--skip-marketplace-register',
    ], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /lifecycle hooks overlap/);
  } finally {
    rmSync(isolatedHome, { recursive: true, force: true });
  }
});

test('atomic config writes replace existing text without leaving temporary files', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-atomic-write-'));
  const path = join(root, 'nested', 'config.json');
  try {
    writeTextAtomic(path, 'old\n');
    writeJsonAtomic(path, { enabled: true });
    assert.equal(readFileSync(path, 'utf8'), '{\n  "enabled": true\n}\n');
    assert.deepEqual(readdirSync(join(root, 'nested')).sort(), ['config.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('copy rejects file symlinks without copying the target', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-safe-copy-file-'));
  const src = join(root, 'src');
  const dst = join(root, 'dst');
  mkdirSync(src);
  const outside = join(root, 'outside-secret');
  writeFileSync(outside, 'do-not-copy');
  symlinkSync(outside, join(src, 'linked-secret'));

  assert.throws(() => copyTreeNoSymlinks(src, dst), /symlink is not allowed/);
  assert.throws(() => readFileSync(join(dst, 'linked-secret'), 'utf8'));
});

test('copy rejects directory symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-safe-copy-dir-'));
  const src = join(root, 'src');
  const dst = join(root, 'dst');
  const outside = join(root, 'outside');
  mkdirSync(src);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'do-not-copy');
  symlinkSync(outside, join(src, 'linked-directory'));

  assert.throws(() => copyTreeNoSymlinks(src, dst), /symlink is not allowed/);
});

test('build rejects traversal before touching an outside sentinel', () => {
  const sentinel = join(REPO_ROOT, 'build-security-sentinel');
  writeFileSync(sentinel, 'preserve-me');
  try {
    const result = spawnSync(process.execPath, ['scripts/build.mjs', '../build-security-sentinel'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /invalid preset name/);
    assert.equal(readFileSync(sentinel, 'utf8'), 'preserve-me');
  } finally {
    safeRemoveWithin(REPO_ROOT, sentinel);
  }
});

test('git mutation hook leaves the parent session in control and restricts role children', () => {
  const hook = join(REPO_ROOT, 'packages/core/hooks/git-custodian-guard.mjs');
  const run = (command, role = '') => spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, CC_NEXS_ROLE: role },
  });
  assert.equal(run('git status --short').status, 0);
  assert.equal(run('git commit -m user-authorized').status, 0);
  assert.equal(run('git commit -m test', 'tech-lead').status, 2);
  assert.equal(run('git worktree remove /tmp/example', 'reviewer').status, 2);
  assert.equal(run('git commit -m candidate', 'git-custodian').status, 0);
});

test('human checkpoints do not install a global tool-blocking hook', () => {
  for (const preset of ['preset-standard', 'preset-minimal']) {
    const hooks = readFileSync(join(REPO_ROOT, 'packages', preset, 'hooks', 'hooks.json'), 'utf8');
    assert.doesNotMatch(hooks, /approval-gate-guard/);
  }
});

test('plugin hook launchers resolve roots through Node on every host shell', () => {
  const temp = mkdtempSync(join(tmpdir(), 'cc-nexs-hook-launch-'));
  const pluginRoot = join(temp, 'cc nexs 中文');
  try {
    copyTreeNoSymlinks(join(REPO_ROOT, 'packages', 'core', 'hooks'), join(pluginRoot, 'hooks'));
    copyTreeNoSymlinks(join(REPO_ROOT, 'packages', 'core', 'lib'), join(pluginRoot, 'lib'));

    const config = JSON.parse(readFileSync(
      join(REPO_ROOT, 'packages', 'preset-standard', 'hooks', 'hooks.json'),
      'utf8',
    ));
    const handlers = config.hooks.PreToolUse.flatMap((group) => group.hooks);
    const commandFor = (script) => handlers.find((handler) => handler.command.includes(script))?.command;
    const allowInput = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'node --version' } });

    for (const handler of handlers) {
      assert.doesNotMatch(handler.command, /\$\{[^}]*:-/);
      assert.doesNotMatch(handler.command, /CODEX_PLUGIN_ROOT/);
      assert.match(handler.command, /process\.env\.PLUGIN_ROOT/);
      assert.match(handler.command, /process\.env\.CLAUDE_PLUGIN_ROOT/);

      for (const rootVariable of ['PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT']) {
        const env = { ...process.env, [rootVariable]: pluginRoot };
        delete env[rootVariable === 'PLUGIN_ROOT' ? 'CLAUDE_PLUGIN_ROOT' : 'PLUGIN_ROOT'];
        delete env.CC_NEXS_PLUGIN_ROOT;
        const result = spawnSync(handler.command, {
          shell: true,
          input: allowInput,
          encoding: 'utf8',
          env,
        });
        assert.equal(result.status, 0, `${rootVariable}: ${result.stderr || result.stdout}`);
      }
    }

    const denied = spawnSync(commandFor('git-custodian-guard.mjs'), {
      shell: true,
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m blocked' } }),
      encoding: 'utf8',
      env: { ...process.env, PLUGIN_ROOT: pluginRoot, CC_NEXS_ROLE: 'reviewer' },
    });
    assert.equal(denied.status, 2);
    assert.match(denied.stderr, /BLOCKED: role reviewer cannot mutate Git/);

    const missingRootEnv = { ...process.env };
    delete missingRootEnv.PLUGIN_ROOT;
    delete missingRootEnv.CLAUDE_PLUGIN_ROOT;
    delete missingRootEnv.CC_NEXS_PLUGIN_ROOT;
    const missingRoot = spawnSync(commandFor('role-boundary-guard.mjs'), {
      shell: true,
      input: allowInput,
      encoding: 'utf8',
      env: missingRootEnv,
    });
    assert.equal(missingRoot.status, 1);
    assert.match(missingRoot.stderr, /plugin root is unavailable/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
