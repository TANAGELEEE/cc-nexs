import assert from 'node:assert/strict';
import test from 'node:test';

import { assertVerificationBlocker } from './test-verification-control.mjs';
import { mergeVerifierResults, renderPanelVerification, resolveVerifyPanel } from './verification-panel.mjs';

const pass = (check, proof = 'journey ok') => ({ check, result: 'passed', proof });
const fail = (check, proof = '500 on save') => ({ check, result: 'failed', proof });
const notRun = (check, extra = {}) => ({ check, result: 'not_run', reason: 'no ops-purpose key in test02', ...extra });
const verifier = (id, checks) => ({ verifier: id, model: id === 'v1' ? 'fable' : 'gpt-6.1-sol', checks });
const requiredChecks = ['TV-001', 'TV-002'];

test('two Verifiers that agree decide a check; one that passes is enough when the other could not run it', () => {
  const merged = mergeVerifierResults([
    verifier('v1', [pass('TV-001'), fail('TV-002')]),
    verifier('v2', [notRun('TV-001'), fail('TV-002', 'save returns 500')]),
  ], { requiredChecks });
  assert.equal(merged.status, 'blocked');
  assert.deepEqual(merged.rows.map((row) => [row.check, row.result]), [['TV-001', 'passed'], ['TV-002', 'failed']]);
  assert.match(renderPanelVerification({ attemptId: 'test-release-2', environmentRevision: { web: 'a'.repeat(40) }, status: merged.status, rows: merged.rows, models: merged.models }),
    /\| TV-002 \| failed: 500 on save \| failed: save returns 500 \| failed \|\n\n测试结论: 阻塞/);
});

test('a failure only one Verifier saw is rerun by another before it can block or be dismissed', () => {
  const results = [verifier('v1', [pass('TV-001'), fail('TV-002')]), verifier('v2', [pass('TV-001'), pass('TV-002')])];
  assert.throws(() => mergeVerifierResults(results, { requiredChecks }), /rerun these checks with another Verifier.*TV-002 \(failed only by v1\)/);
  assert.throws(() => mergeVerifierResults(results, { requiredChecks, confirmations: [{ check: 'TV-002', result: 'failed', proof: 'same 500', verifier: 'v1' }] }), /other than v1/);
  const confirmed = mergeVerifierResults(results, { requiredChecks, confirmations: [{ check: 'TV-002', result: 'failed', proof: 'reproduced: 500 on save', verifier: 'v2' }] });
  assert.equal(confirmed.status, 'blocked');
  const refuted = mergeVerifierResults(results, { requiredChecks, confirmations: [{ check: 'TV-002', result: 'passed', proof: 'saved; v1 hit a stale session', verifier: 'v2' }] });
  assert.equal(refuted.status, 'passed');
});

test('a check no Verifier could run becomes one concrete human-input blocker', () => {
  const vague = mergeVerifierResults([verifier('v1', [pass('TV-001'), notRun('TV-002')]), verifier('v2', [pass('TV-001'), notRun('TV-002')])], { requiredChecks });
  assert.equal(vague.status, 'manual_required');
  assert.throws(() => assertVerificationBlocker(vague.status, vague.evidence), /human_input_required evidence/, 'a not_run without the ask cannot stop the run');
  const asked = mergeVerifierResults([
    verifier('v1', [pass('TV-001'), notRun('TV-002', { attempted: 'SQL insert refused: read-only user', required_input: 'a test02 DB account with insert on api_key', resume_action: 'record-test-verification after creating the key' })]),
    verifier('v2', [pass('TV-001'), notRun('TV-002')]),
  ], { requiredChecks });
  assert.doesNotThrow(() => assertVerificationBlocker(asked.status, asked.evidence));
});

test('the panel result must come from exactly the configured Verifiers and cover every check', () => {
  const panel = resolveVerifyPanel({ panel: { claude: [{ id: 'v1' }, { id: 'v2', profile: 'acceptance' }] } }, 'claude');
  assert.deepEqual(panel.map((item) => item.id), ['v1', 'v2']);
  assert.deepEqual(resolveVerifyPanel({ panel: { codex: [{}, {}] } }, 'claude'), []);
  assert.throws(() => resolveVerifyPanel({ panel: [{ id: 'v1' }] }, 'claude'), /at least two Verifiers/);
  assert.throws(() => mergeVerifierResults([verifier('v1', [pass('TV-001'), pass('TV-002')]), verifier('v3', [pass('TV-001'), pass('TV-002')])], { requiredChecks, panel }),
    /the verification panel is v1, v2; got results from v1, v3/);
  assert.throws(() => mergeVerifierResults([verifier('v1', [pass('TV-001')]), verifier('v2', [pass('TV-001'), pass('TV-002')])], { requiredChecks }), /v1 did not report TV-002/);
  assert.throws(() => mergeVerifierResults([verifier('v1', [pass('TV-001'), { check: 'TV-002', result: 'passed' }]), verifier('v2', [pass('TV-001'), pass('TV-002')])], { requiredChecks }), /passed needs proof/);
});
