// Smoke tests for state-machine.
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

const fullRoles = ['repo-scout', 'planner', 'tech-lead', 'sa', 'qa', 'evaluator'];

// --- RECON path ---

test('full mode: REQ_DRAFTED → RECON_DONE when repo-scout enabled', () => {
  const r = nextStep({ ...baseFull, state: 'REQ_DRAFTED', enabledRoles: fullRoles });
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
  const r = nextStep({ ...baseFull, state: 'RECON_DONE', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPEC_DRAFTED');
  assert.equal(r.role, 'planner');
  assert.equal(r.action, 'draft_spec');
});

test('full mode: SPEC_NEEDS_REVISION goes to SPEC_DRAFTED (does NOT re-run recon)', () => {
  const r = nextStep({ ...baseFull, state: 'SPEC_NEEDS_REVISION', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPEC_DRAFTED');
  assert.equal(r.role, 'planner');
  assert.equal(r.action, 'revise_spec');
});

// --- Sprint phase transitions (full mode) ---

test('full mode: SPRINT_1_KICKOFF → SPRINT_1_DEV with parallel QA cases', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_1_KICKOFF', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPRINT_1_DEV');
  assert.equal(r.role, 'tech-lead');
  assert.equal(r.action, 'implement');
  assert.equal(r.parallel.role, 'qa');
  assert.equal(r.parallel.action, 'write_cases');
});

test('full mode: SPRINT_1_DEV → SPRINT_1_DOC_SYNC (tech-lead syncs docs after coding)', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_1_DEV', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPRINT_1_DOC_SYNC');
  assert.equal(r.role, 'tech-lead');
  assert.equal(r.action, 'sync_docs');
});

test('full mode: SPRINT_1_DOC_SYNC → SPRINT_1_SA_CODE (SA reviews code after doc sync)', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_1_DOC_SYNC', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPRINT_1_SA_CODE');
  assert.equal(r.role, 'sa');
  assert.equal(r.action, 'review_code');
});

test('full mode: SPRINT_1_QA_CASES → SPRINT_1_SA_TEST_REVIEW', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_1_QA_CASES', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPRINT_1_SA_TEST_REVIEW');
  assert.equal(r.role, 'sa');
  assert.equal(r.action, 'review_test_cases');
});

test('full mode: SPRINT_1_FIX → SPRINT_1_QA_REGRESSION', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_1_FIX', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPRINT_1_QA_REGRESSION');
  assert.equal(r.role, 'qa');
  assert.equal(r.action, 'regression');
});

test('full mode: SPRINT_2_DONE → ALL_SPRINTS_DONE when N >= total', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_2_DONE', enabledRoles: fullRoles });
  assert.equal(r.next, 'ALL_SPRINTS_DONE');
});

test('full mode: SPRINT_1_DONE → SPRINT_2_KICKOFF when more sprints remain', () => {
  const r = nextStep({ ...baseFull, state: 'SPRINT_1_DONE', enabledRoles: fullRoles });
  assert.equal(r.next, 'SPRINT_2_KICKOFF');
});

// --- fast mode ---

test('fast mode: REQ_DRAFTED → SPEC_DRAFTED with fullstack', () => {
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
