import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRoleRuntime } from './runtime-resolver.mjs';

const preset = { roles: { definitions: { dev: { tool: 'claude-subagent' }, review: { tool: 'codex' } } } };
for (const runtime of ['claude', 'codex', 'pi']) {
  test(`${runtime}: live proposal resolves without overlay and respects explicit pins`, () => {
    const modelCatalog = { runtime, models: [{ id: 'new-model', efforts: ['high'] }, { id: 'pinned-model' }] };
    const options = { modelCatalog, modelProposal: { model: 'new-model', effort: 'high', reason: 'Host advertises required capability' } };
    const selected = resolveRoleRuntime(preset, 'dev', runtime, options);
    assert.equal(selected.model, 'new-model');
    assert.equal(selected.model_selection.source, 'host-discovery');
    assert.equal(selected.effort, 'high');
    const pinned = resolveRoleRuntime(preset, 'dev', runtime, { ...options, featureModels: { roles: { dev: { [runtime]: { model: 'pinned-model' } } } } });
    assert.equal(pinned.model, 'pinned-model');
    assert.equal(pinned.model_selection.source, 'explicit-config');
    assert.throws(() => resolveRoleRuntime(preset, 'dev', runtime, { ...options, modelProposal: { model: 'missing', reason: 'guess' } }), /not available/);
    assert.throws(() => resolveRoleRuntime(preset, 'dev', runtime, { ...options, modelProposal: { model: 'new-model', effort: 'ultra', reason: 'guess' } }), /does not support/);
    assert.throws(() => resolveRoleRuntime(preset, 'dev', runtime, { ...options, modelProposal: { model: 'new-model' } }), /requires a reason/);
  });
}
test('actual external executor wins over parent host and absent discovery preserves inheritance', () => {
  assert.equal(resolveRoleRuntime(preset, 'dev', 'pi').model, 'inherit');
  assert.throws(() => resolveRoleRuntime(preset, 'review', 'claude', { modelCatalog: { runtime: 'claude', models: [] } }), /executor/);
  const result = resolveRoleRuntime(preset, 'review', 'claude', { modelCatalog: { runtime: 'codex', models: [{ id: 'external' }] }, modelProposal: { model: 'external', reason: 'external executor capability' } });
  assert.equal(result.model, 'external');
  assert.throws(() => resolveRoleRuntime(preset, 'dev', 'codex', { modelProposal: { model: 'unknown', reason: 'guess' } }), /snapshot/);
});
