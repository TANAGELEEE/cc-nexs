#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const generatedTargets = [
  'dist',
  'pi/agents',
  'pi/skills',
  '.claude-plugin/marketplace.json',
  '.agents/plugins/marketplace.json',
];

function digestGenerated() {
  const hash = createHash('sha256');
  function walk(current, targetRoot) {
    for (const entry of readdirSync(current).sort()) {
      const file = join(current, entry);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`symlink in generated output: ${relative(root, file)}`);
      if (stat.isDirectory()) walk(file, targetRoot);
      else if (stat.isFile()) {
        hash.update(relative(root, targetRoot));
        hash.update('\0');
        hash.update(relative(targetRoot, file));
        hash.update('\0');
        hash.update(readFileSync(file));
        hash.update('\0');
      }
    }
  }
  for (const target of generatedTargets) {
    const absolute = join(root, target);
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

execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
const first = digestGenerated();
execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
const second = digestGenerated();
if (first !== second) throw new Error(`generated outputs are not reproducible: ${first} != ${second}`);
console.log(`Reproducible generated outputs: ${second}`);
