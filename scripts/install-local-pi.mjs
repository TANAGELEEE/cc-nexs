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

if (!installed.includes('pi-computer-use')) {
  console.warn('WARN @injaneity/pi-computer-use@0.4.3 is not installed; automatic browser verification will fall back to manual G2.');
  console.warn('Install: pi install git:github.com/injaneity/pi-computer-use@v0.4.3');
}

run('pi', ['install', root, '--approve'], { stdio: 'inherit' });
console.log('cc-nexs Pi package installed. Restart Pi or run /reload.');
console.log('Lean/Hotfix role model/thinking overrides are optional; automatic risk routing uses escalated, with feature role profiles final.');
console.log('Fast keeps its legacy review policy; Hotfix uses dedicated Developer/Reviewer/Verifier package agents.');
