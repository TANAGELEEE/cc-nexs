import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
