#!/usr/bin/env node
// Opt-in live inference smoke; uses the installed Pi packages and credentials.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const model = process.env.CC_NEXS_PI_SMOKE_MODEL;
assert(model, 'Set CC_NEXS_PI_SMOKE_MODEL; this smoke performs real paid inference');
const root = resolve(import.meta.dirname, '..');
const cwd = mkdtempSync(join(tmpdir(), 'cc-nexs-pi-workflow-'));
mkdirSync(join(cwd, '.cc-nexs'));
writeFileSync(join(cwd, '.cc-nexs/workspace.json'), '{}\n');
const report = join(cwd, 'report.json');
const child = spawnSync('pi', [
  '--no-session', '--no-mcp', '--no-context-files', '--no-skills',
  '-e', join(root, 'scripts/fixtures/pi-model-workflow.ts'),
  '--model', model, '--thinking', 'low',
  '--tools', 'cc_live_probe,cc_nexs_models,cc_nexs_model_gateway,cc_nexs_dispatch',
  '--mode', 'json', '-p',
  'Call cc_live_probe once only. It orchestrates the entire authorized integration smoke. Return its result. Do not call other tools yourself.',
], { cwd, encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, CC_NEXS_PI_SMOKE_REPORT: report } });
writeFileSync(join(cwd, 'events.jsonl'), child.stdout || '', { mode: 0o600 });
writeFileSync(join(cwd, 'stderr.log'), child.stderr || '', { mode: 0o600 });
assert.equal(child.status, 0, `Pi workflow failed; inspect ${cwd}`);
console.log(readFileSync(report, 'utf8'));
console.log(`Evidence retained in ${cwd}`);
