import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runCcNexsCommand } from './cc-nexs-cli.mjs';
import { createProgressV2, writeProgressV2 } from './progress-v2.mjs';

test('dispatch resolves role models from the task without a request file and records the result', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-dispatch-'));
  const saved = process.env.CC_NEXS_PLUGIN_ROOT;
  process.env.CC_NEXS_PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'preset-standard');
  try {
    const dir = join(root, '.cc-nexs', 'hotfixes', 'h-1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, '.cc-nexs', 'workspace.json'), `${JSON.stringify({ version: 1, repositories: [{ id: 'code', path: 'code', base_branch: 'master' }] })}\n`);
    writeFileSync(join(root, '.cc-nexs', 'overlay.yml'), 'models:\n  roles:\n    hotfix-developer:\n      codex:\n        model: dev-model\n        effort: high\n');
    const progress = createProgressV2({ featureId: 'h-1', featureSlug: 'h-1', preset: 'preset-standard', mode: 'hotfix' });
    writeProgressV2(join(dir, 'progress.json'), progress);
    const args = ['h-1', '--runtime', 'codex', '--progress', join(dir, 'progress.json')];
    assert.throws(() => runCcNexsCommand(['dispatch', ...args, '--role', 'hotfix-developer'], { cwd: root }), /requires --reason/);
    const result = runCcNexsCommand(['dispatch', ...args, '--role', 'hotfix-developer', '--role', 'hotfix-verifier', '--reason', 'bound two-file fix'], { cwd: root });
    assert.equal(result.kind, 'dispatch');
    assert.deepEqual(result.rows.map((row) => row.role), ['hotfix-developer', 'hotfix-verifier']);
    assert.equal(result.rows[0].model, 'dev-model');
    assert.equal(result.rows[0].effort, 'high');
    const recorded = runCcNexsCommand(['dispatch-result', ...args, '--batch', result.batch, '--role', 'hotfix-developer', '--outcome', 'succeeded', '--evidence', 'developer returned a candidate'], { cwd: root });
    assert.equal(recorded.outcome, 'succeeded');
  } finally {
    if (saved === undefined) delete process.env.CC_NEXS_PLUGIN_ROOT; else process.env.CC_NEXS_PLUGIN_ROOT = saved;
    rmSync(root, { recursive: true, force: true });
  }
});
