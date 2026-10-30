#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { copyTreeNoSymlinks } from './lib/safe-fs.mjs';

const root = resolve(import.meta.dirname, '..');
const generatedTargets = [
  'dist',
  'pi/agents',
  'pi/skills',
  '.claude-plugin/marketplace.json',
  '.agents/plugins/marketplace.json',
];

function digestGenerated(projectRoot = root) {
  const hash = createHash('sha256');
  function walk(current, targetRoot) {
    for (const entry of readdirSync(current).sort()) {
      const file = join(current, entry);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`symlink in generated output: ${relative(root, file)}`);
      if (stat.isDirectory()) walk(file, targetRoot);
      else if (stat.isFile()) {
        hash.update(relative(projectRoot, targetRoot));
        hash.update('\0');
        hash.update(relative(targetRoot, file));
        hash.update('\0');
        hash.update(readFileSync(file));
        hash.update('\0');
      }
    }
  }
  for (const target of generatedTargets) {
    const absolute = join(projectRoot, target);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) walk(absolute, absolute);
    else {
      hash.update(target);
      hash.update('\0');
      hash.update(readFileSync(absolute));
      hash.update('\0');
    }
  }
  return hash.digest('hex');
}

const CRLF_TEXT_EXTENSIONS = /\.(?:html|js|json|md|mjs|sh|ts|ya?ml)$/i;

function convertSourceTreeToCrlf(projectRoot) {
  function walk(current) {
    for (const entry of readdirSync(current).sort()) {
      const file = join(current, entry);
      const stat = lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile() && CRLF_TEXT_EXTENSIONS.test(entry)) {
        const text = readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
        writeFileSync(file, text.replace(/\n/g, '\r\n'), 'utf8');
      }
    }
  }
  walk(projectRoot);
}

function assertCrlfSourceBuildMatches(expectedDigest) {
  const fixtureParent = mkdtempSync(join(tmpdir(), 'cc-nexs-crlf-build-'));
  const fixtureRoot = join(fixtureParent, 'repo');
  const excludedRoots = new Set([
    '.git',
    'dist',
    'node_modules',
    'pi/agents',
    'pi/skills',
  ]);
  try {
    copyTreeNoSymlinks(root, fixtureRoot, {
      exclude: (path) => {
        const rel = relative(root, path).split('\\').join('/');
        return excludedRoots.has(rel);
      },
    });
    convertSourceTreeToCrlf(fixtureRoot);
    execFileSync(process.execPath, [join(fixtureRoot, 'scripts/build.mjs')], {
      cwd: fixtureRoot,
      env: { ...process.env, CI: 'false' },
      stdio: 'inherit',
    });
    const actualDigest = digestGenerated(fixtureRoot);
    if (actualDigest !== expectedDigest) {
      throw new Error(`CRLF source build differs from LF build: ${actualDigest} != ${expectedDigest}`);
    }
  } finally {
    rmSync(fixtureParent, { recursive: true, force: true });
  }
}

execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
const first = digestGenerated();
execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
const second = digestGenerated();
if (first !== second) throw new Error(`generated outputs are not reproducible: ${first} != ${second}`);
assertCrlfSourceBuildMatches(second);
console.log(`Reproducible generated outputs: ${second}`);
console.log('CRLF source build matches LF generated outputs');
