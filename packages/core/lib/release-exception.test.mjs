import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateFingerprint, createProgressV2 } from './progress-v2.mjs';
import { createReleaseExceptionBinding, assertReleaseExceptionCurrent } from './release-exception.mjs';

const authorization = {
  authorizationEvidence: 'User message 42: merge this candidate and perform formal acceptance after deployment',
  reason: 'Shared test account cannot access the required page',
  environmentEvidence: 'HTTP 403 for the test account; administrator confirmed missing environment permissions',
  rollbackEvidence: 'Revert candidate to base commit abc; no data migration',
};

function fixture(mode = 'hotfix') {
  const progress = createProgressV2({ featureId: '1', featureSlug: 'demo', preset: 'preset-standard', mode });
  const source = { api: 'a'.repeat(40) };
  const fingerprint = candidateFingerprint(source);
  const attempt = {
    id: 'test-release-1', status: 'deployed_needs_manual_verification', source, fingerprint,
    pipeline: { id: 'pipeline-1' }, deployment: { environment: 'test' },
    integrations: { api: { sourceCommit: source.api, integrationCommit: 'b'.repeat(40) } },
    environment_revision: { api: 'b'.repeat(40) },
    verification: { result: 'manual_required', evidence: ['Permission missing'], recorded_at: '2026-09-26T00:00:00Z' },
  };
  progress.delivery.test.attempts = [attempt];
  progress.local_verification = {
    status: 'passed', candidate_fingerprint: fingerprint,
    attempts: [{ id: 'local-verify-1', status: 'passed', source, fingerprint, evidence: [{ check: 'repro', result: 'passed', command: 'node repro.mjs', exit_code: 0, proof: 'regression passed' }] }],
  };
  progress.review = { status: 'passed', candidate_fingerprint: fingerprint };
  return progress;
}

test('explicit environment exception preserves unverified test and binds exact evidence', () => {
  for (const mode of ['lean', 'hotfix']) {
    const progress = fixture(mode);
    const original = structuredClone(progress);
    const attempt = progress.delivery.test.attempts[0];
    const binding = {
      source: attempt.source, candidate_fingerprint: attempt.fingerprint,
      test_attempt: attempt.id, environment_revision: attempt.environment_revision,
      test_exception: createReleaseExceptionBinding(progress, authorization),
    };
    assert.doesNotThrow(() => assertReleaseExceptionCurrent(progress, binding));
    assert.deepEqual(progress, original);
    const changed = structuredClone(progress);
    changed.delivery.test.attempts[0].verification.evidence = ['different reason'];
    assert.throws(() => assertReleaseExceptionCurrent(changed, binding), /evidence changed/);
    changed.delivery.test.attempts[0] = { ...attempt, id: 'test-release-2' };
    assert.throws(() => assertReleaseExceptionCurrent(changed, binding), /evidence changed/);
  }
});

test('exception refuses missing authorization, product failure, incomplete deployment, and stale validation', () => {
  for (const field of Object.keys(authorization)) {
    assert.throws(() => createReleaseExceptionBinding(fixture(), { ...authorization, [field]: '' }), new RegExp(field));
  }
  const mutations = [
    (p) => { p.delivery.test.attempts[0].invalidated_at = '2026-09-26T01:00:00Z'; },
    (p) => { p.delivery.test.attempts[0].status = 'failed'; },
    (p) => { p.delivery.test.attempts[0].verification.result = 'blocked'; },
    (p) => { p.delivery.test.attempts[0].verification.evidence = []; },
    (p) => { p.events.push({ type: 'delivery.test.verification_blocked', data: { attempt: 'test-release-1' } }); },
    (p) => { p.delivery.test.attempts[0].pipeline = null; },
    (p) => { p.delivery.test.attempts[0].deployment.environment = 'production'; },
    (p) => { p.delivery.test.attempts[0].environment_revision.api = 'other'; },
    (p) => { p.delivery.test.attempts[0].integrations.api.sourceCommit = 'other'; },
    (p) => { p.delivery.test.attempts[0].integrations = {}; },
    (p) => { p.delivery.test.attempts[0].source.api = 'other'; },
    (p) => { p.local_verification.status = 'deferred_to_test'; },
    (p) => { p.local_verification.attempts[0].evidence = []; },
    (p) => { p.local_verification.attempts[0].evidence[0].result = 'failed'; },
    (p) => { p.local_verification.candidate_fingerprint = 'old'; },
    (p) => { p.review.status = 'blocked'; },
    (p) => { p.review.candidate_fingerprint = 'old'; },
  ];
  for (const mutate of mutations) {
    const progress = fixture();
    mutate(progress);
    assert.throws(() => createReleaseExceptionBinding(progress, authorization), /\[cc-nexs\]/);
  }
});
