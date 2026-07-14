#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');

function digestTree(dir) {
  const hash = createHash('sha256');
  function walk(current) {
    for (const entry of readdirSync(current).sort()) {
      const file = join(current, entry);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`symlink in dist: ${relative(root, file)}`);
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) {
        hash.update(relative(dir, file));
        hash.update('\0');
        hash.update(readFileSync(file));
        hash.update('\0');
      }
    }
  }
  walk(dir);
  return hash.digest('hex');
}

execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
const first = digestTree(dist);
execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
const second = digestTree(dist);
if (first !== second) throw new Error(`dist is not reproducible: ${first} != ${second}`);
console.log(`Reproducible dist: ${second}`);
