#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  inspectPiBrowserCapability,
  PI_FALLBACK_BROWSER_PROVIDER,
} from '../packages/core/lib/pi-browser-provider.mjs';

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

const browserCapability = inspectPiBrowserCapability({ projectRoot: root, piListOutput: installed });
if (!browserCapability.ready) {
  console.warn(`WARN automatic Pi browser verification is unavailable: ${browserCapability.reason}`);
  console.warn('Preferred setup: npx skills add citrolabs/ego-lite, then open ego lite and finish onboarding.');
  console.warn(`Fallback setup: pi install git:github.com/injaneity/pi-computer-use@v0.4.3, then set browser_use=true and headless=true in .pi/computer-use.json.`);
  console.warn('Without either provider, test release will fall back to manual G2.');
} else if (browserCapability.fallback) {
  console.log(`Pi browser fallback ready: ${PI_FALLBACK_BROWSER_PROVIDER} with headless=true.`);
} else {
  console.log('Pi browser provider ready: ego-lite.');
}

run('pi', ['install', root, '--approve'], { stdio: 'inherit' });
console.log('cc-nexs Pi package installed. Restart Pi or run /reload.');
console.log('Lean/Hotfix role model/thinking overrides are optional; automatic risk routing uses escalated, with feature role profiles final.');
console.log('Fast keeps its legacy review policy; Hotfix uses dedicated Developer/Reviewer/Verifier package agents.');
