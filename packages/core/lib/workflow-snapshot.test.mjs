import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCcNexsCommand } from './cc-nexs-cli.mjs';
import { createProgressV2, readProgressV2, writeProgressV2 } from './progress-v2.mjs';
import { advanceFeatureState, buildWorkflowSnapshot, featureStatus } from './workflow-snapshot.mjs';

function fixture(mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-snapshot-'));
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../preset-standard/preset.yml'), join(root, '.cc-nexs', 'preset.yml'));
  writeFileSync(join(root, 'cc-nexs.config.yml'), 'preset_path: .cc-nexs\n');
  writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), 'version: 1\n');
  const docs = join(root, 'all-docs', 'doc', '51.snapshot');
  mkdirSync(docs, { recursive: true });
  const progress = createProgressV2({ featureId: '51', featureSlug: 'snapshot', preset: 'preset-standard', mode: 'lean' });
  mutate(progress);
  writeProgressV2(join(docs, 'progress.json'), progress);
  writeFileSync(join(docs, 'progress.md'), `## 当前状态\n\n\`\`\`yaml\ncurrent_state: ${progress.state}\nupdated_at: null\n\`\`\`\n\n## 历史轨迹\n\n- (尚无)\n`);
  return { root, docs };
}

function withPluginRoot(root, fn) {
  const saved = process.env.CC_NEXS_PLUGIN_ROOT;
  process.env.CC_NEXS_PLUGIN_ROOT = join(root, '.cc-nexs');
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.CC_NEXS_PLUGIN_ROOT;
    else process.env.CC_NEXS_PLUGIN_ROOT = saved;
  }
}

test('snapshot mirrors the run.md workflow rules from authoritative progress', () => {
  const current = fixture((progress) => {
    progress.state = 'LOCAL_VERIFYING';
    progress.gates.plan = { approved: true, binding: { delivery_lane: 'fast_track' } };
    progress.local_verification = { status: 'passed', context: null, candidate_fingerprint: 'fp', attempts: [{ fingerprint: 'old' }, { fingerprint: 'fp' }] };
    progress.review = { status: 'passed', candidate_fingerprint: 'fp', reviewed_commits: {}, blocking_findings: [], closure_attempts: 1, gateway_b_delta_attempts: 0 };
    progress.delivery.test.attempts = [{ id: 'a', deployment: { environment: 'test' }, environment_revision: { api: 'x' } }, { id: 'b' }];
    progress.counters = { fix_per_bug: { 'BUG-1': 1 } };
  });
  try {
    withPluginRoot(current.root, () => {
      const { input } = buildWorkflowSnapshot({ cwd: current.root, featureId: '51' });
      assert.equal(input.mode, 'lean');
      assert.equal(input.state, 'LOCAL_VERIFYING');
      assert.deepEqual(input.counters, { fix_per_bug: { 'BUG-1': 1 } });
      assert.deepEqual(input.thresholds, { review_revision: 3, fix_per_bug: 3 });
      assert.ok(input.enabledRoles.includes('lean-developer'));
      assert.equal(input.workflow.plan_approved, true);
      assert.equal(input.workflow.delivery_lane, 'fast_track');
      assert.equal(input.workflow.review.exact, true);
      assert.equal(input.workflow.review.closure_attempts, 1);
      assert.equal(input.workflow.test_release.attempt, 1);
      assert.equal(buildWorkflowSnapshot({ cwd: current.root, featureId: '51', noAutoTestRelease: true }).input.workflow.test_release.policy, 'manual');
    });
  } finally { rmSync(current.root, { recursive: true, force: true }); }
});

test('review evidence for another fingerprint is not exact', () => {
  const current = fixture((progress) => {
    progress.state = 'LOCAL_VERIFYING';
    progress.local_verification = { status: 'passed', context: null, candidate_fingerprint: 'new', attempts: [{ fingerprint: 'new' }] };
    progress.review = { status: 'passed', candidate_fingerprint: 'old', reviewed_commits: {}, blocking_findings: [], closure_attempts: 0, gateway_b_delta_attempts: 0 };
  });
  try {
    withPluginRoot(current.root, () => {
      assert.equal(buildWorkflowSnapshot({ cwd: current.root, featureId: '51' }).input.workflow.review.exact, false);
    });
  } finally { rmSync(current.root, { recursive: true, force: true }); }
});

test('status reports nextStep for the current state', () => {
  const current = fixture((progress) => { progress.state = 'PLANNING'; });
  try {
    withPluginRoot(current.root, () => {
      const status = runCcNexsCommand(['status', '51'], { cwd: current.root });
      assert.equal(status.kind, 'feature-status');
      assert.deepEqual(status.next, { next: 'PLAN_REVIEWING', role: 'lean-plan-reviewer', action: 'review_plan' });
      assert.equal(featureStatus({ cwd: current.root, featureId: '51' }).revision, status.revision);
    });
  } finally { rmSync(current.root, { recursive: true, force: true }); }
});

test('advance persists one guarded transition and rejects stale or empty moves', () => {
  const current = fixture((progress) => { progress.state = 'PLANNING'; });
  try {
    withPluginRoot(current.root, () => {
      const result = runCcNexsCommand(['advance', '51', '--from', 'PLANNING', '--to', 'PLAN_REVIEWING', '--reason', 'planner done'], { cwd: current.root });
      assert.equal(result.to, 'PLAN_REVIEWING');
      assert.equal(result.expectedNext, 'PLAN_REVIEWING');
      const progress = readProgressV2(join(current.docs, 'progress.json'));
      assert.equal(progress.state, 'PLAN_REVIEWING');
      assert.equal(progress.events.at(-1).reason, 'planner done');
      assert.match(readFileSync(join(current.docs, 'progress.md'), 'utf8'), /current_state: PLAN_REVIEWING/);
      assert.throws(() => advanceFeatureState({ cwd: current.root, featureId: '51', from: 'PLANNING', to: 'PLAN_REVIEWING' }), /state mismatch/);
      assert.throws(() => advanceFeatureState({ cwd: current.root, featureId: '51', from: 'PLAN_REVIEWING', to: 'PLAN_REVIEWING' }), /equals the current state/);
      assert.throws(() => runCcNexsCommand(['advance', '51', '--to', 'X'], { cwd: current.root }), /--from/);
      assert.equal(readProgressV2(join(current.docs, 'progress.json')).revision, progress.revision);
    });
  } finally { rmSync(current.root, { recursive: true, force: true }); }
});
