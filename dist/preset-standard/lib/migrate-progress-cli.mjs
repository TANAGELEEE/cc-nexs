#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { readProgress } from './progress-io.mjs';
import { createProgressV2, progressJsonForMarkdown, writeProgressV2 } from './progress-v2.mjs';

const markdown = resolve(process.argv[2] || 'progress.md');
const json = progressJsonForMarkdown(markdown);
if (!existsSync(markdown)) throw new Error(`progress.md not found: ${markdown}`);
if (existsSync(json) && !process.argv.includes('--force')) throw new Error(`progress.json already exists: ${json}`);

const legacy = readProgress(markdown);
const featureId = legacy.raw.match(/feature_id:\s*([^\s]+)/)?.[1] || 'unknown';
const featureSlug = legacy.raw.match(/feature_slug:\s*([^\s]+)/)?.[1] || 'unknown';
const preset = legacy.raw.match(/preset:\s*([^\s]+)/)?.[1] || 'preset-standard';
const mode = legacy.raw.match(/mode:\s*(full|fast|hotfix|lite)/)?.[1] || 'fast';
const progress = createProgressV2({
  featureId,
  featureSlug,
  preset,
  mode,
  deliveryStrategy: 'per_sprint',
  testReleasePolicy: 'manual',
});
progress.state = legacy.current_state;
progress.counters = { ...progress.counters, ...legacy.counters };
progress.sprint = { ...progress.sprint, ...legacy.sprint };
progress.gates.g1 = {
  approved: Boolean(legacy.gate?.approved_at || legacy.gate?.human_approved_at),
  approver: legacy.gate?.approver || legacy.gate?.human_approver || null,
  approved_at: legacy.gate?.approved_at || legacy.gate?.human_approved_at || null,
};
progress.gates.g2.approved = legacy.workflow?.g2_approved === true;
progress.revision = 1;
progress.updated_at = new Date().toISOString();
progress.events = [{
  id: `legacy-import-${Date.now()}`,
  sequence: 1,
  timestamp: progress.updated_at,
  type: 'legacy.imported',
  actor: 'migrator',
  from: 'INIT',
  to: progress.state,
  data: { legacy_history: legacy.history },
}];
writeProgressV2(json, progress);
console.log(`Migrated ${markdown} -> ${json}`);
