import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyReviewFindings, extractReviewBlock, readReviewFindings } from './finding-contract.mjs';

const panel = [{ id: 'r1', executor: 'native' }, { id: 'r2', executor: 'codex-cli' }];
const both = [{ id: 'r1', executor: 'native', model: 'opus' }, { id: 'r2', executor: 'codex-cli', model: 'gpt-6-astra' }];

const run = { kind: 'run', command: 'node --test api/limit.test.mjs', observed: 'expected 429, got 200', expected: '429' };

function finding(overrides = {}) {
  return {
    id: 'F-1',
    severity: 'P1',
    location: 'api/limit.mjs:42',
    anchor: 'AC-003',
    failure_scenario: 'the 101st request in a minute returns 200 instead of 429',
    evidence: run,
    judge: { verdict: 'confirmed', rerun: 'expected 429, got 200' },
    ...overrides,
  };
}

function document(block) {
  return `# Plan\n\n## Review\n\n\`\`\`cc-nexs-review\n${JSON.stringify(block, null, 2)}\n\`\`\`\n\n结论: PASS\n`;
}

test('only a P0/P1 failure demonstrated by a run blocks', () => {
  const result = classifyReviewFindings([
    finding(),
    finding({ id: 'F-2', evidence: { kind: 'trace', refs: ['api/limit.mjs:42'] } }),
    finding({ id: 'F-3', severity: 'P2' }),
  ]);
  assert.deepEqual(result.counts, { blocking: 1, unproven: 1, refuted: 0, advisory: 1, rejected: 0 });
  assert.deepEqual(result.blockingFindings, ['P1: F-1 api/limit.mjs:42 — the 101st request in a minute returns 200 instead of 429']);
  assert.equal(result.classified[1].reason, 'no run demonstrated the failure');
});

test('a speculative security risk argued from code alone does not block', () => {
  const result = classifyReviewFindings([finding({
    anchor: 'security',
    failure_scenario: 'an attacker who learns releaseHash could replay resize messages',
    evidence: { kind: 'trace', refs: ['web/preview.ts:88'] },
  })]);
  assert.equal(result.classified[0].class, 'unproven');
  assert.deepEqual(result.blockingFindings, []);
});

test('candidate and evidence inconsistency blocks without a run', () => {
  const result = classifyReviewFindings([finding({
    anchor: 'evidence-mismatch',
    evidence: { kind: 'trace', refs: ['local evidence fingerprint differs from candidate'] },
  })]);
  assert.equal(result.classified[0].class, 'blocking');
});

test('malformed, off-anchor, and duplicate findings are rejected instead of blocking', () => {
  const result = classifyReviewFindings([
    finding({ failure_scenario: '' }),
    finding({ id: 'F-2', anchor: 'style' }),
    finding({ id: 'F-3', evidence: { kind: 'run', command: 'npm test' } }),
    finding({ id: 'F-4', severity: 'P1+' }),
    finding({ id: 'F-5', evidence: { kind: 'opinion' } }),
    finding(),
    finding(),
    'P1: free text',
  ]);
  assert.deepEqual(result.counts, { blocking: 1, unproven: 0, refuted: 0, advisory: 0, rejected: 7 });
  assert.deepEqual(result.classified.filter((item) => item.class === 'rejected').map((item) => item.reason), [
    'missing failure_scenario',
    'anchor must be an AC id, contract, data, security, regression, or evidence-mismatch',
    'run evidence needs command and observed output',
    'severity must be P0, P1, P2, or P3',
    'evidence.kind must be run or trace',
    'duplicate id',
    'finding must be an object',
  ]);
});

test('an Orchestrator rerun that does not reproduce downgrades the finding', () => {
  const result = classifyReviewFindings([finding()], { notReproduced: ['F-1'] });
  assert.equal(result.classified[0].class, 'unproven');
  assert.equal(result.classified[0].reason, 'Orchestrator rerun did not reproduce the failure');
  assert.throws(() => classifyReviewFindings([finding()], { notReproduced: ['F-9'] }), /unknown finding ids: F-9/);
});

test('only a Judge rerun that confirms the failure lets a run finding block', () => {
  const result = classifyReviewFindings([
    finding({ id: 'F-1', judge: { verdict: 'refuted', rerun: 'got 429' } }),
    finding({ id: 'F-2', judge: { verdict: 'plausible', rerun: 'flaky: 429 twice, 200 once' } }),
    finding({ id: 'F-3', judge: undefined }),
    finding({ id: 'F-4', judge: { verdict: 'confirmed', rerun: '' } }),
    finding({ id: 'F-5', anchor: 'evidence-mismatch', evidence: { kind: 'trace', refs: ['fingerprint'] }, judge: { verdict: 'refuted', rerun: 'fingerprints match' } }),
    finding({ id: 'F-6', judge: { verdict: 'approved' } }),
  ]);
  assert.deepEqual(result.classified.map((item) => item.class), ['refuted', 'unproven', 'unproven', 'unproven', 'refuted', 'rejected']);
  assert.deepEqual(result.blockingFindings, []);
});

test('a consolidated Review lists every panel reviewer; a closure lists one', () => {
  const source = { api: 'abc123' };
  const block = (reviewers, round = 'consolidated', findings = []) => document({ round, candidate: source, reviewers, findings });
  const read = (text, round = 'consolidated') => readReviewFindings(text, { round, source, panel });
  assert.deepEqual(read(block(both)).reviewers, both);
  assert.throws(() => read(block(both.slice(0, 1))), /missing panel reviewer\(s\) r2/);
  assert.throws(() => read(block([...both, { id: 'r3', executor: 'native', model: 'x' }])), /r3, which is not in review.panel/);
  assert.throws(() => read(block([{ ...both[0] }, { ...both[1], executor: 'claude-cli' }])), /r2 is codex-cli in review.panel/);
  assert.throws(() => read(block([both[0], both[0]])), /reviewer twice/);
  assert.throws(() => read(block([{ id: 'r1', executor: 'native' }, both[1]])), /\{id, executor, model\}/);
  assert.throws(() => read(block(undefined)), /must list its reviewers/);
  assert.equal(read(block(both.slice(1), 'closure'), 'closure').counts.blocking, 0);
  assert.throws(() => read(block(both, 'closure'), 'closure'), /closure Review uses exactly one reviewer/);

  const agreed = read(block(both, 'consolidated', [finding({ found_by: ['r1', 'r2'] }), finding({ id: 'F-2', found_by: ['r9'] })]));
  assert.deepEqual(agreed.classified.map((item) => item.class), ['blocking', 'rejected']);
  assert.match(agreed.classified[1].reason, /found_by must name reviewers listed/);
});

test('the last review block must match the round and the exact candidate', () => {
  const source = { api: 'abc123', web: 'def456' };
  const options = (round, candidate = source) => ({ round, source: candidate, panel });
  const text = document({ round: 'consolidated', candidate: { web: 'def456', api: 'abc123' }, reviewers: both, findings: [finding()] });
  assert.equal(readReviewFindings(text, options('consolidated')).counts.blocking, 1);
  assert.throws(() => readReviewFindings(text, options('closure')), /for consolidated, but this record is closure/);
  assert.throws(() => readReviewFindings(text, options('consolidated', { api: 'abc123' })), /does not match the exact candidate/);

  const closure = text + document({ round: 'closure', candidate: source, reviewers: both.slice(0, 1), findings: [] });
  assert.deepEqual(readReviewFindings(closure, options('closure')).counts, { blocking: 0, unproven: 0, refuted: 0, advisory: 0, rejected: 0 });
});

test('missing or invalid review blocks fail closed', () => {
  assert.throws(() => extractReviewBlock('# Plan\n\n结论: PASS\n'), /no `cc-nexs-review` block/);
  assert.throws(() => extractReviewBlock('```cc-nexs-review\n{ nope\n```\n'), /not valid JSON/);
  assert.throws(() => readReviewFindings(document({ round: 'final', candidate: {}, findings: [] }), { round: 'consolidated', source: {}, panel }), /round must be/);
});
