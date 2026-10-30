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

run(process.execPath, [resolve(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
run(process.execPath, [resolve(root, 'scripts', 'validate-pi-package.mjs')], { stdio: 'inherit' });

const installed = run('pi', ['list']);

const browserCapability = inspectPiBrowserCapability({ projectRoot: root, piListOutput: installed });
if (!browserCapability.ready) {
  console.warn(`WARN automatic Pi browser verification is unavailable: ${browserCapability.reason}`);
  console.warn('Preferred setup: npx skills add citrolabs/ego-lite, then open ego lite and finish onboarding.');
  console.warn(`Fallback setup: pi install git:github.com/injaneity/pi-computer-use@v0.4.3, then set browser_use=true and headless=true in .pi/computer-use.json.`);
  console.warn('Test merge/CI delivery remains available. After deployment, verification records manual_required and can resume when browser/login capability is restored.');
} else if (browserCapability.fallback) {
  console.log(`Pi browser fallback ready: ${PI_FALLBACK_BROWSER_PROVIDER} with headless=true.`);
} else {
  console.log('Pi browser provider ready: ego-lite.');
}

// Replace the previous cc-nexs source, not the user's other Pi packages.
for (const line of installed.split('\n')) {
  const source = line.trim();
  if (/^git:.*\/cc-nexs(?:@[^ ]+)?$/.test(source)) run('pi', ['remove', source], { stdio: 'inherit' });
}
run('pi', ['install', root, '--approve'], { stdio: 'inherit' });
console.log('cc-nexs Pi package installed. Restart Pi or run /reload.');
console.log('Lean/Hotfix role model/thinking overrides are optional; automatic risk routing uses escalated, with feature role profiles final.');
console.log('cc_nexs_dispatch runs each role as an isolated Pi process in its assigned worktree; no subagent package is required.');
