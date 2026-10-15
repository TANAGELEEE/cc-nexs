import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRuntimeCompatible, runtimeIdentity } from './runtime-identity.mjs';
import { createProgressV2, readProgressV2, writeProgressV2 } from './progress-v2.mjs';

test('patch upgrades accept old tasks without rebinding evidence; downgrades reject', () => {
  const progress = { runtime: { name: 'cc-nexs', version: '0.5.5' } };
  assertRuntimeCompatible(progress, { name: 'cc-nexs', version: '0.5.8' });
  assertRuntimeCompatible({}, runtimeIdentity());
  assert.throws(() => assertRuntimeCompatible(progress, { name: 'cc-nexs', version: '0.5.4' }), /runtime version mismatch/);
  assert.throws(() => assertRuntimeCompatible(progress, { name: 'cc-nexs', version: '0.6.0' }), /runtime version mismatch/);
  assert.match(runtimeIdentity().version, /^\d+\.\d+\.\d+$/);
});

test('forked stale snapshots cannot overwrite newer progress; writing a promoted copy is supported', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-snapshot-'));
  try {
    const file = join(root, 'progress.json');
    writeProgressV2(file, createProgressV2({ featureId: '1', featureSlug: 'test', preset: 'preset-standard', mode: 'lean' }));
    const first = readProgressV2(file);
    const stale = readProgressV2(file);
    first.state = 'PLAN_DRAFTING';
    writeProgressV2(file, first);
    stale.state = 'COMPLETE';
    assert.throws(() => writeProgressV2(file, stale), /stale progress snapshot/);
    assert.equal(readProgressV2(file).state, 'PLAN_DRAFTING');
    writeProgressV2(join(root, 'promoted.json'), first);
    writeProgressV2(file, readProgressV2(file));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
