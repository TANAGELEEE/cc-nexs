#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const target = mkdtempSync(join(tmpdir(), 'cc-nexs-public-release-'));

function git(cwd, args, options = {}) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  }).trim();
}

try {
  const files = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0').filter(Boolean).sort();
  for (const file of files) {
    const source = join(root, file);
    if (!existsSync(source)) continue;
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error(`symlink refused in public export: ${file}`);
    if (!stat.isFile()) continue;
    const destination = join(target, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }

  git(target, ['init', '-b', 'main']);
  git(target, ['config', 'user.name', 'cc-nexs release bot']);
  git(target, ['config', 'user.email', 'cc-nexs@users.noreply.github.com']);
  git(target, ['add', '--all']);
  git(target, ['commit', '-m', 'chore: public v0.4.0 import']);
  execFileSync(process.execPath, [join(target, 'scripts/public-audit.mjs'), '--history'], {
    cwd: target, stdio: 'inherit', env: { ...process.env, CC_NEXS_PUBLIC_DENYLIST_FILE: process.env.CC_NEXS_PUBLIC_DENYLIST_FILE || '' },
  });
  const commits = git(target, ['rev-list', '--count', 'HEAD']);
  if (commits !== '1') throw new Error(`expected one clean public commit, found ${commits}`);
  console.log('Clean-history public release smoke passed (one noreply import commit).');
} finally {
  rmSync(target, { recursive: true, force: true });
}
