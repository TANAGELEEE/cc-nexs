import assert from 'node:assert/strict';
import test from 'node:test';

import { extractLocalVerificationChecks, validateLocalEvidence } from './local-evidence.mjs';

const lint = { check: 'LV-001', result: 'passed', command: 'pnpm lint', exit_code: 0, proof: 'clean' };
const browser = {
  check: 'LV-002',
  result: 'passed',
  method: 'browser',
  command: 'browser: pnpm dev @ /settings',
  proof: 'Settings footer stays above the fold at 375px',
};
const expectedChecks = [
  { check: 'LV-001', command: 'pnpm lint' },
  { check: 'LV-002', command: 'browser: pnpm dev @ /settings', method: 'browser' },
];

test('matrix extraction marks only browser rows', () => {
  const checks = extractLocalVerificationChecks([
    '| Check | Command |',
    '|---|---|',
    '| LV-001 | `pnpm lint` |',
    '| LV-002 | `browser: pnpm dev @ /settings` |',
  ].join('\n'));
  assert.deepEqual(checks, expectedChecks);
  assert.equal(Object.hasOwn(checks[0], 'method'), false);
});

test('browser evidence satisfies a bound browser row without an exit code', () => {
  assert.doesNotThrow(() => validateLocalEvidence('passed', [lint, browser], { expectedChecks }));
  const failed = { ...browser, result: 'failed', proof: 'Footer overlaps the submit button' };
  assert.doesNotThrow(() => validateLocalEvidence('failed', [lint, failed], { expectedChecks }));
});

test('browser evidence requires proof and a browser command', () => {
  assert.throws(() => validateLocalEvidence('passed', [lint, { ...browser, proof: ' ' }]), /browser local evidence requires/);
  assert.throws(() => validateLocalEvidence('passed', [lint, { ...browser, command: 'pnpm dev' }]), /browser local evidence requires/);
});

test('a browser row and a command row cannot stand in for each other', () => {
  const asCommand = { check: browser.check, result: 'passed', command: browser.command, exit_code: 0, proof: 'ran' };
  assert.throws(() => validateLocalEvidence('passed', [lint, asCommand], { expectedChecks }), /requires browser evidence/);
  const asBrowser = { ...lint, method: 'browser', command: 'browser: pnpm dev @ /settings' };
  assert.throws(() => validateLocalEvidence('passed', [asBrowser, browser], { expectedChecks }), /does not match the bound matrix/);
});

test('a passing result still needs one executed command', () => {
  assert.throws(() => validateLocalEvidence('passed', [browser]), /at least one passed command/);
});

test('Lean can defer a browser row, and evidence without a method keeps the command contract', () => {
  const deferred = { check: browser.check, result: 'deferred_to_test', reason: 'backend change is not deployed', test_action: 'verify on test' };
  assert.doesNotThrow(() => validateLocalEvidence('deferred_to_test', [lint, deferred], { allowTestDefer: true, expectedChecks }));
  assert.throws(() => validateLocalEvidence('passed', [{ ...lint, exit_code: undefined }]), /exit_code=0/);
});
