import { resolveFeatureProgress } from './approval-command.mjs';
import { readProgressV2 } from './progress-v2.mjs';

const ACTIVE_GAP_MS = 2 * 60 * 60 * 1000;
const CONFLICT_END = new Set(['delivery.test.merge_conflict_resolved', 'delivery.test.target_advanced', 'delivery.test.started']);
const CONFLICT_EXIT_STATES = new Set(['TEST_FIXING', 'PLANNING', 'PLAN_REVIEWING', 'HOTFIX_FIXING']);

// Where a task's time and rework went, from its own event ledger. Gaps longer
// than two hours count as idle, so overnight waits do not inflate active time.
export function computeTaskStats(progress) {
  const events = progress.events || [];
  const at = (event) => Date.parse(event.timestamp);
  const count = (type) => events.filter((event) => event.type === type).length;
  let activeMs = 0;
  for (let index = 1; index < events.length; index += 1) {
    const gap = at(events[index]) - at(events[index - 1]);
    if (gap > 0 && gap < ACTIVE_GAP_MS) activeMs += gap;
  }
  const approvals = {};
  for (const event of events.filter((item) => item.type === 'gate.approved')) {
    const gate = event.data?.gate || 'unknown';
    approvals[gate] = (approvals[gate] || 0) + 1;
  }
  const byAttempt = new Map();
  for (const event of events) {
    const attempt = event.type.startsWith('delivery.test.') ? event.data?.attempt : null;
    if (attempt) byAttempt.set(attempt, [...(byAttempt.get(attempt) || []), event]);
  }
  let conflictMs = 0;
  let deployMs = 0;
  let conflictAttempts = 0;
  for (const list of byAttempt.values()) {
    const conflict = list.find((event) => event.type === 'delivery.test.merge_conflict');
    if (conflict) {
      conflictAttempts += 1;
      const end = events.find((event) => event.sequence > conflict.sequence
        && (CONFLICT_END.has(event.type) || (event.type === 'state.transition' && CONFLICT_EXIT_STATES.has(event.to))));
      if (end) conflictMs += at(end) - at(conflict);
    }
    const waiting = list.find((event) => ['delivery.test.awaiting_receipt', 'delivery.test.deploying'].includes(event.type));
    const done = list.find((event) => ['delivery.test.succeeded', 'delivery.test.failed'].includes(event.type));
    if (waiting && done && at(done) >= at(waiting)) deployMs += at(done) - at(waiting);
  }
  const attempts = progress.delivery?.test?.attempts || [];
  const minutes = (ms) => Math.round(ms / 60000);
  return {
    elapsed_minutes: minutes(Date.parse(progress.updated_at) - Date.parse(progress.created_at)),
    active_minutes: minutes(activeMs),
    human_approvals: approvals,
    plan_reviews: count('plan.reviewed'),
    plan_amendments: count('plan.amendment_requested'),
    candidates: count('repository.candidate_prepared') + count('repository.candidate_recorded'),
    local_verifications: { passed: count('local_verification.passed'), failed: count('local_verification.failed') },
    test_attempts: attempts.length,
    test_deployments: attempts.filter((attempt) => attempt.deployment && attempt.environment_revision).length,
    test_conflict_attempts: conflictAttempts,
    test_target_advances: count('delivery.test.target_advanced'),
    conflict_minutes: minutes(conflictMs),
    deploy_wait_minutes: minutes(deployMs),
    base_attempts: progress.delivery?.base?.attempts?.length || 0,
  };
}

export function taskStats({ cwd = process.cwd(), featureId, progressPath = null } = {}) {
  if (!featureId) throw new Error('feature id is required');
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const progress = readProgressV2(progressFile);
  return { kind: 'task-stats', feature: progress.feature, state: progress.state, stats: computeTaskStats(progress), progressFile };
}
