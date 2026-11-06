import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewRequirement, reviewSatisfied } from './review-policy.mjs';

const lean = (risk, paths = {}) => ({
  mode: 'lean',
  gates: { plan: { binding: { risk_tier: risk } } },
  repositories: Object.fromEntries(Object.entries(paths).map(([id, list]) => [id, { candidate: { paths: list } }])),
});

test('a low or medium Lean task is gated by verification unless it touches sensitive paths', () => {
  assert.equal(reviewRequirement(lean('medium', { web: ['src/app/page.tsx'] })).required, false);
  const auth = reviewRequirement(lean('low', { api: ['src/auth/session.ts', 'src/app.ts'] }));
  assert.equal(auth.required, true);
  assert.match(auth.reasons[0], /api:src\/auth\/session\.ts/);
  assert.equal(reviewRequirement(lean('medium', { api: ['db/migrations/001.sql'] })).required, true);
  assert.equal(reviewRequirement(lean('medium', { web: ['src/billing/plan.ts'] })).required, true);
});

test('high risk, a missing risk tier, configured paths, policy always, and Hotfix keep the Review', () => {
  assert.equal(reviewRequirement(lean('high')).required, true);
  assert.equal(reviewRequirement(lean('critical')).required, true);
  assert.equal(reviewRequirement(lean(null)).required, true);
  const contracts = { required_paths: ['src/lib/public-apis/**'] };
  assert.equal(reviewRequirement(lean('low', { web: ['src/lib/public-apis/catalog.ts'] }), contracts).required, true);
  assert.equal(reviewRequirement(lean('low', { web: ['src/app/page.tsx'] }), contracts).required, false);
  assert.equal(reviewRequirement(lean('low'), { policy: 'always' }).required, true);
  assert.equal(reviewRequirement({ mode: 'hotfix' }).required, true);
  assert.throws(() => reviewRequirement(lean('low'), { policy: 'never' }), /review.policy must be risk or always/);
});

test('a required Review is satisfied only by a pass for the exact candidate', () => {
  const required = { required: true, reasons: [] };
  assert.equal(reviewSatisfied({ review: { status: 'passed', candidate_fingerprint: 'a' } }, 'a', required), true);
  assert.equal(reviewSatisfied({ review: { status: 'passed', candidate_fingerprint: 'a' } }, 'b', required), false);
  assert.equal(reviewSatisfied({ review: { status: 'idle' } }, 'a', { required: false, reasons: [] }), true);
});
