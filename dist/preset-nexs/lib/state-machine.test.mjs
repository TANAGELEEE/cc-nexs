// Smoke tests for state-machine RECON path.
// Run: npm run test:hooks

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStep } from './state-machine.mjs';

const baseFull = {
  counters: { review_revision: 0, fix_per_bug: {}, evaluator_reject: 0 },
  thresholds: { review_revision: 3, fix_per_bug: 3, evaluator_reject: 2 },
  sprint: { current: 1, total: 2 },
  humanGateApproved: false,
  mode: 'full',
};

test('full mode: REQ_DRAFTED → RECON_DONE when repo-scout enabled', () => {
  const r = nextStep({
    ...baseFull,
    state: 'REQ_DRAFTED',
    enabledRoles: ['repo-scout', 'planner', 'tech-lead', 'sa', 'qa', 'evaluator'],
  });
  assert.equal(r.next, 'RECON_DONE');
  assert.equal(r.role, 'repo-scout');
  assert.equal(r.action, 'recon');
});

test('full mode: REQ_DRAFTED → SPEC_DRAFTED when repo-scout NOT enabled (back-compat)', () => {
  const r = nextStep({
    ...baseFull,
    state: 'REQ_DRAFTED',
    enabledRoles: ['planner', 'tech-lead', 'sa', 'qa', 'evaluator'],
  });
  assert.equal(r.next, 'SPEC_DRAFTED');
  assert.equal(r.role, 'planner');
  assert.equal(r.action, 'draft_spec');
});

test('full mode: RECON_DONE → SPEC_DRAFTED with planner', () => {
  const r = nextStep({
    ...baseFull,
    state: 'RECON_DONE',
    enabledRoles: ['repo-scout', 'planner', 'tech-lead', 'sa', 'qa', 'evaluator'],
  });
  assert.equal(r.next, 'SPEC_DRAFTED');
  assert.equal(r.role, 'planner');
  assert.equal(r.action, 'draft_spec');
});

test('full mode: SPEC_NEEDS_REVISION goes to SPEC_DRAFTED (does NOT re-run recon)', () => {
  const r = nextStep({
    ...baseFull,
    state: 'SPEC_NEEDS_REVISION',
    enabledRoles: ['repo-scout', 'planner', 'tech-lead', 'sa', 'qa', 'evaluator'],
  });
  assert.equal(r.next, 'SPEC_DRAFTED');
  assert.equal(r.role, 'planner');
  assert.equal(r.action, 'revise_spec');
});

test('fast mode: REQ_DRAFTED → SPEC_DRAFTED with fullstack (recon folded into command, not state machine)', () => {
  const r = nextStep({
    state: 'REQ_DRAFTED',
    counters: { review_revision: 0, fix_per_bug: {}, evaluator_reject: 0 },
    thresholds: { review_revision: 2, fix_per_bug: 2, evaluator_reject: 2 },
    enabledRoles: ['fullstack', 'reviewer', 'verifier'],
    humanGateApproved: false,
    mode: 'fast',
  });
  assert.equal(r.next, 'SPEC_DRAFTED');
  assert.equal(r.role, 'fullstack');
  assert.equal(r.action, 'draft_spec');
});
