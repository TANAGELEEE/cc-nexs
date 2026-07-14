import assert from 'node:assert/strict';
import test from 'node:test';

import { planReviewerInvocation } from './reviewer-adapter.mjs';

test('reviewer invocation keeps hostile prompt text in a single argv element', () => {
  const prompt = 'review $(touch /tmp/should-not-run); `whoami`';
  const plan = planReviewerInvocation({ tool: 'codex', prompt, diffFile: '/tmp/a diff.txt' });
  assert.equal(plan.executable, 'codex');
  assert.deepEqual(plan.args, ['--file', '/tmp/a diff.txt', prompt]);
  assert.equal('command' in plan, false);
});

test('custom reviewer requires argv template', () => {
  assert.throws(() => planReviewerInvocation({ tool: 'custom', prompt: 'x', customTemplate: 'tool {prompt}' }), /argv array/);
});
