import assert from 'node:assert/strict';
import test from 'node:test';
import { assertVerificationBlocker, verificationResultState } from './test-verification-control.mjs';

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
