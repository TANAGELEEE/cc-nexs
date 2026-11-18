import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCompleteFailureRecord, assertVerificationBlocker, verificationResultState } from './test-verification-control.mjs';

test('unfinished verification cannot masquerade as a human-input blocker', () => {
  assert.throws(() => assertVerificationBlocker('manual_required', ['not tested yet']), /unfinished automated verification must continue/);
  const blocker = { type: 'human_input_required', check: 'authorized-tools-list', reason: 'test account lacks permission', attempted: 'existing authenticated test session returned 403', required_input: 'grant the test account the required role', resume_action: 'repeat tools/list against the same deployed revision' };
  assert.doesNotThrow(() => assertVerificationBlocker('manual_required', [blocker]));
  for (const field of ['check', 'reason', 'attempted', 'required_input', 'resume_action']) assert.throws(() => assertVerificationBlocker('manual_required', [{ ...blocker, [field]: '' }]), /manual_required needs/);
  assert.doesNotThrow(() => assertVerificationBlocker('passed', ['real evidence']));
});

test('verification results persist actionable Lean and Hotfix states rather than TEST_RELEASE', () => {
  for (const [mode, prefix] of [['lean', ''], ['hotfix', 'HOTFIX_']]) {
    assert.equal(verificationResultState(mode, 'passed'), `${prefix}TEST_VERIFIED`);
    assert.equal(verificationResultState(mode, 'manual_required'), `${prefix}TEST_DEPLOYED_NEEDS_MANUAL_VERIFY`);
    assert.equal(verificationResultState(mode, 'blocked'), mode === 'lean' ? 'TEST_VERIFY_FAILED' : 'HOTFIX_TEST_FAILED');
  }
  assert.equal(verificationResultState('full', 'passed'), null);
});

test('pre-existing defects require comparative evidence, not an unsupported unrelated-bug label', () => {
  const blocker = {
    type: 'human_input_required', cause: 'pre_existing_defect', check: 'existing-result-read',
    reason: 'upstream query fails before adapter runs', attempted: 'compared baseline and candidate',
    required_input: 'provide a working dataset or explicitly accept this uncovered check',
    resume_action: 'verify the same deployed candidate with the supplied dataset',
    baseline_commit: 'a'.repeat(40), baseline_proof: 'baseline reproduction log',
    candidate_proof: 'candidate reproduction log', impact: 'result reads unverified; staging checks pass',
    alternative_attempted: 'other approved representative dataset also unavailable',
    tracking: 'separate upstream defect record', review_proof: 'independent review of reproduction and affected call chain',
  };
  assert.doesNotThrow(() => assertVerificationBlocker('manual_required', [blocker]));
  for (const field of ['baseline_commit', 'baseline_proof', 'candidate_proof', 'impact', 'alternative_attempted', 'tracking', 'review_proof']) {
    assert.throws(() => assertVerificationBlocker('manual_required', [{ ...blocker, [field]: '' }]), /pre_existing_defect requires/);
  }
});

const failed = (check) => ({ check, result: 'failed', proof: 'observed failure' });
const passed = (check) => ({ check, result: 'passed', proof: 'ok' });

test('a blocked verification must report every check before the repair round', () => {
  assert.doesNotThrow(() => assertCompleteFailureRecord([
    failed('TV-001'), passed('TV-002'),
    { check: 'TV-003', result: 'not_run', reason: 'upload page never loads', blocked_by: 'TV-001' },
    { check: 'TV-004', result: 'not_run', reason: 'needs a paid account', required_input: 'a test02 account with credits' },
    { check: 'TV-005', result: 'waived', proof: 'skipped', authorization_evidence: 'user: skip the GIF check this round' },
    passed('LV-007'),
  ], ['TV-001', 'TV-002', 'TV-003', 'TV-004', 'TV-005', 'LV-007']));
  assert.throws(() => assertCompleteFailureRecord([failed('TV-001')], ['TV-001', 'TV-002', 'LV-007']), /must report every check.*missing: TV-002, LV-007/);
  assert.throws(() => assertCompleteFailureRecord([passed('TV-001')], ['TV-001']), /at least one failed check/);
  assert.throws(() => assertCompleteFailureRecord([failed('TV-001'), { check: 'TV-002', result: 'partial', proof: 'half' }], ['TV-001', 'TV-002']), /result must be passed, failed, not_run, or waived, found partial/);
  assert.throws(() => assertCompleteFailureRecord([failed('TV-001'), { check: 'TV-002', result: 'not_run', reason: 'later' }], ['TV-001', 'TV-002']), /not_run needs reason and blocked_by/);
  assert.throws(() => assertCompleteFailureRecord([failed('TV-001'), { check: 'TV-002', result: 'not_run', reason: 'x', blocked_by: 'TV-009' }], ['TV-001', 'TV-002']), /blocked_by TV-009 names no failed check/);
  assert.throws(() => assertCompleteFailureRecord([failed('TV-001'), { check: 'TV-002', result: 'waived', proof: 'x' }], ['TV-001', 'TV-002']), /waived needs the user's authorization_evidence/);
});
