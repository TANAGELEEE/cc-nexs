import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { modelGateway } from './model-gateway.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { runCcNexsCommand } from './cc-nexs-cli.mjs';
import { writeFileSync } from 'node:fs';

function fixture(runtime = 'codex') {
  const cwd = mkdtempSync(join(tmpdir(), 'cc-model-gateway-'));
  const base = { runtime, context: 'native:account-one:default-model' };
  const request = {
    ...base,
    preset: { roles: { definitions: { dev: { tool: 'claude-subagent' } } } },
    catalogs: { [runtime]: { runtime, source: 'native', models: [
      { id: 'daily', efforts: ['medium', 'high'], apiKey: 'secret-not-cached' },
      { id: 'review', efforts: ['high'] },
    ] } },
    tasks: [{ role: 'dev', difficulty: 'moderate', reason: 'Existing API with two known callers', proposal: { model: 'daily', effort: 'medium', reason: 'Host-supported daily model' } }],
  };
  return { cwd, base, request, call: (op, fields = {}) => modelGateway(op, { ...base, ...fields }, { cwd }) };
}

for (const runtime of ['claude', 'codex', 'pi']) {
  test(`${runtime}: preview never blocks, learns successful dispatch and reuses without discovery`, () => {
    const f = fixture(runtime);
    try {
      const first = f.call('prepare', f.request);
      assert.equal(first.blocking, false);
      assert.equal(first.showPreview, true);
      assert.match(readFileSync(first.preview, 'utf8'), /No response is required/);
      assert.doesNotMatch(readFileSync(first.stateFile, 'utf8'), /secret-not-cached/);
      const batchId = first.batch.id;
      assert.throws(() => f.call('result', { batchId, role: 'dev', outcome: 'succeeded', evidence: 'unexecuted' }), /not started/);
      const started = f.call('start', { batchId });
      assert.equal(started.batch.rows[0].selection.model, 'daily');
      assert.deepEqual(f.call('start', { batchId }).batch, started.batch);
      f.call('result', { batchId, role: 'dev', outcome: 'succeeded', evidence: 'agent-1 completed successfully' });
      const reusable = structuredClone(f.request);
      delete reusable.catalogs;
      delete reusable.tasks[0].proposal;
      reusable.options = { models: { roles: { unrelated: { codex: { model: 'other' } } } } };
      const second = f.call('prepare', reusable);
      assert.equal(second.batch.rows[0].selection.model, 'daily');
      assert.equal(second.batch.rows[0].source, 'successful-dispatch');
      assert.equal(second.showPreview, false);
      reusable.tasks[0].difficulty = 'complex';
      const complex = f.call('prepare', reusable);
      assert.equal(complex.batch.rows[0].selection.model, 'inherit');
      assert.equal(complex.showPreview, true);
      const other = f.call('inspect', { context: 'another-account' });
      assert.deepEqual(other.catalogs, {});
      assert.equal(other.learnedCount, 0);
      assert.equal(other.preferenceCount, 0);
      const compact = f.call('inspect');
      assert.equal(compact.catalogs[runtime].modelCount, 2);
      assert.equal(compact.catalogs[runtime].models, undefined);
    } finally { rmSync(f.cwd, { recursive: true, force: true }); }
  });
}

test('user feedback overrides proposals, never changes running rows, and rejects stale previews', () => {
  const f = fixture();
  try {
    const first = f.call('prepare', f.request);
    const batchId = first.batch.id;
    const corrected = f.call('feedback', { batchId, revision: 1, role: 'dev', model: 'review', effort: 'high', reason: 'User requested review model' });
    assert.equal(corrected.applies, 'this-batch');
    assert.throws(() => f.call('feedback', { batchId, revision: 1, role: 'dev', model: 'daily', reason: 'old preview' }), /stale/);
    const started = f.call('start', { batchId });
    assert.equal(started.batch.rows[0].selection.model, 'review');
    const late = f.call('feedback', { batchId, revision: started.batch.revision, role: 'dev', model: 'daily', effort: 'high', reason: 'Use daily next time' });
    assert.equal(late.applies, 'next-batch');
    assert.equal(late.batch.rows[0].selection.model, 'review');
    f.call('result', { batchId, role: 'dev', outcome: 'succeeded', evidence: 'old running child completed' });
    const nextRequest = structuredClone(f.request);
    nextRequest.tasks[0].proposal = { model: 'review', effort: 'high', reason: 'new parent proposal' };
    const next = f.call('prepare', nextRequest);
    assert.equal(next.batch.rows[0].selection.model, 'daily');
    assert.equal(next.batch.rows[0].selection.effort, 'high');
    assert.equal(next.batch.rows[0].source, 'user-preference');
  } finally { rmSync(f.cwd, { recursive: true, force: true }); }
});

test('transport failures invalidate discovery; business failures do not; pins remain authoritative', () => {
  const f = fixture();
  try {
    const first = f.call('prepare', f.request);
    const batchId = first.batch.id;
    f.call('start', { batchId });
    f.call('result', { batchId, role: 'dev', outcome: 'task-failed', evidence: 'unit assertion failed' });
    assert.ok(f.call('inspect').catalogs.codex);
    const second = f.call('prepare', f.request);
    f.call('start', { batchId: second.batch.id });
    f.call('result', { batchId: second.batch.id, role: 'dev', outcome: 'model-unavailable', evidence: 'provider rejected model' });
    assert.deepEqual(f.call('inspect').catalogs, {});
    const pin = structuredClone(f.request);
    pin.options = { featureModels: { roles: { dev: { codex: { model: 'review', effort: 'high' } } } } };
    assert.throws(() => f.call('prepare', pin), /explicit model pin/);
    delete pin.tasks[0].proposal;
    const pinned = f.call('prepare', pin);
    assert.throws(() => f.call('feedback', { batchId: pinned.batch.id, revision: 1, role: 'dev', model: 'daily', reason: 'change old pin' }), /explicit model configuration/);
  } finally { rmSync(f.cwd, { recursive: true, force: true }); }
});

test('CLI inspects cache without model calls or feature progress mutations', () => {
  const f = fixture();
  try {
    const input = join(f.cwd, 'request.json');
    writeFileSync(input, JSON.stringify(f.base));
    const result = runCcNexsCommand(['model-gateway', 'inspect', '--request', input], { cwd: f.cwd });
    assert.equal(result.blocking, false);
    assert.deepEqual(result.catalogs, {});
    assert.throws(() => runCcNexsCommand(['model-gateway', 'inspect'], { cwd: f.cwd }), /--request/);
  } finally { rmSync(f.cwd, { recursive: true, force: true }); }
});

test('policy/risk changes do not reuse an old combination; refreshed catalogs discard only learned defaults', () => {
  const f = fixture();
  try {
    const prepared = f.call('prepare', f.request);
    f.call('start', { batchId: prepared.batch.id });
    f.call('result', { batchId: prepared.batch.id, role: 'dev', outcome: 'succeeded', evidence: 'successful actual child' });
    const changed = structuredClone(f.request);
    delete changed.tasks[0].proposal;
    changed.options = { modelContext: { mode: 'lean', risk_tier: 'high', source: 'new risk evidence' } };
    assert.equal(f.call('prepare', changed).batch.rows[0].selection.model, 'inherit');
    delete changed.options;
    changed.catalogs.codex.models = [{ id: 'replacement' }];
    const refreshed = f.call('prepare', changed);
    assert.equal(refreshed.batch.rows[0].selection.model, 'inherit');
    assert.equal(refreshed.batch.rows[0].source, 'learned-choice-unavailable');
    assert.deepEqual(refreshed.batch.rows[0].selectionNotice, {
      type: 'learned-choice-unavailable',
      previousModel: 'daily',
      action: 'fallback-to-inherit',
    });
    assert.match(readFileSync(refreshed.preview, 'utf8'), /Warning: dev learned model daily is unavailable/);
    assert.deepEqual(f.call('inspect', { refresh: true }).catalogs, {});
    assert.throws(() => f.call('prepare', { ...f.request, batchId: '../outside' }), /invalid model batch/);
    assert.throws(() => f.call('prepare', { ...f.request, tasks: [{ role: 'dev', difficulty: 'easy' }] }), /difficulty/);
  } finally { rmSync(f.cwd, { recursive: true, force: true }); }
});

test('model gateway recovers a lock left by a dead process', () => {
  const f = fixture();
  try {
    const lock = join(f.cwd, '.cc-nexs', 'model-dispatch');
    mkdirSync(lock, { recursive: true });
    const stateFile = join(lock, `${createHash('sha256').update(canonicalJson({ runtime: f.base.runtime, context: f.base.context })).digest('hex')}.json.lock`);
    mkdirSync(stateFile, { recursive: true });
    writeFileSync(join(stateFile, 'owner.json'), JSON.stringify({ pid: 99999999, createdAt: Date.now(), token: 'dead' }));
    assert.equal(f.call('inspect').blocking, false);
  } finally { rmSync(f.cwd, { recursive: true, force: true }); }
});

test('model gateway never reaps live or unknown lock owners', () => {
  const f = fixture();
  try {
    const { stateFile } = f.call('inspect');
    const lock = `${stateFile}.lock`;
    mkdirSync(lock);
    for (const owner of [null, 'invalid', JSON.stringify({ pid: process.pid }), JSON.stringify({ pid: -1 })]) {
      if (owner) writeFileSync(join(lock, 'owner.json'), owner);
      assert.throws(() => f.call('inspect'), /busy/);
      assert.ok(existsSync(lock));
    }
  } finally { rmSync(f.cwd, { recursive: true, force: true }); }
});
