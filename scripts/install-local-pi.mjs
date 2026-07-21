#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options });
}

try {
  console.log(`Pi ${run('pi', ['--version']).trim()}`);
} catch {
  console.error('Pi is required. Install @earendil-works/pi-coding-agent first.');
  process.exit(1);
}

run('pnpm', ['build'], { stdio: 'inherit' });
run('pnpm', ['validate:pi'], { stdio: 'inherit' });

const installed = run('pi', ['list']);
if (!installed.includes('pi-subagents')) {
  console.error('pi-subagents 0.35+ is required before installing cc-nexs for Pi.');
  console.error('Run: pi install npm:pi-subagents');
  process.exit(1);
}

run('pi', ['install', root, '--approve'], { stdio: 'inherit' });
console.log('cc-nexs Pi package installed. Restart Pi or run /reload.');
console.log('Configure a different model for cc-nexs.reviewer and cc-nexs.verifier before /cc-nexs:run or reviewed hotfix flows.');
