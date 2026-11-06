import { readdirSync } from 'node:fs';
import { join } from 'node:path';

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
  let autoApprovals = 0;
  for (const event of events.filter((item) => item.type === 'gate.approved')) {
    if (event.actor === 'auto-plan') { autoApprovals += 1; continue; }
    const gate = event.data?.gate || 'unknown';
    approvals[gate] = (approvals[gate] || 0) + 1;
  }
  const reviews = { consolidated: 0, closure: 0, gateway_b_delta: 0, blocked: 0 };
  const findings = { blocking: 0, unproven: 0, refuted: 0, advisory: 0, rejected: 0 };
  for (const event of events) {
    const match = /^review\.(consolidated|closure|gateway_b_delta)_(passed|blocked)$/.exec(event.type);
    if (!match) continue;
    reviews[match[1]] += 1;
    if (match[2] === 'blocked') reviews.blocked += 1;
    for (const [key, value] of Object.entries(event.data?.finding_counts || {})) findings[key] = (findings[key] || 0) + value;
  }
  const planReviews = events.filter((event) => event.type === 'plan.reviewed');
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
    auto_approvals: autoApprovals,
    plan_reviews: planReviews.filter((event) => event.data?.status !== 'skipped').length,
    plan_review_skips: planReviews.filter((event) => event.data?.status === 'skipped').length,
    reviews,
    findings,
    test_verifications: {
      passed: count('delivery.test.verification_passed'),
      blocked: count('delivery.test.verification_blocked'),
      manual_required: count('delivery.test.verification_manual_required'),
    },
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

const SKIP_DIRS = new Set(['.git', '.worktrees', 'node_modules', 'dist', 'build', 'target', 'coverage']);

function findProgressFiles(dir, depth = 0, out = []) {
  if (depth > 6) return out;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) findProgressFiles(join(dir, entry.name), depth + 1, out);
    else if (entry.isFile() && entry.name === 'progress.json') out.push(join(dir, entry.name));
  }
  return out;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

// Aggregate every Lean/Hotfix task under a workspace so a workflow change can be
// compared with the tasks before it. Feature worktrees are skipped to avoid counting
// the docs checkout twice; progress files that are not v2 are reported as skipped.
export function workspaceStats({ cwd = process.cwd(), since = null } = {}) {
  const sinceMs = since ? Date.parse(since) : null;
  if (since && Number.isNaN(sinceMs)) throw new Error(`--since must be a date, got ${since}`);
  const tasks = [];
  let skipped = 0;
  for (const file of findProgressFiles(cwd)) {
    let progress;
    try { progress = readProgressV2(file); } catch { skipped += 1; continue; }
    if (!['lean', 'hotfix'].includes(progress.mode)) { skipped += 1; continue; }
    // Templates ship a progress file whose id is still a placeholder; it is not a task.
    if (/[{}]/.test(`${progress.feature?.id}${progress.feature?.slug}`)) continue;
    if (sinceMs !== null && Date.parse(progress.created_at) < sinceMs) continue;
    tasks.push({ feature: progress.feature, mode: progress.mode, state: progress.state, stats: computeTaskStats(progress) });
  }
  const sum = (pick) => tasks.reduce((total, task) => total + pick(task.stats), 0);
  const findings = {};
  for (const task of tasks) for (const [key, value] of Object.entries(task.stats.findings)) findings[key] = (findings[key] || 0) + value;
  return {
    kind: 'workspace-stats',
    tasks,
    skipped,
    summary: {
      tasks: tasks.length,
      completed: tasks.filter((task) => task.state === 'COMPLETE').length,
      median_active_minutes: median(tasks.map((task) => task.stats.active_minutes)),
      plan_reviews: sum((stats) => stats.plan_reviews),
      plan_review_skips: sum((stats) => stats.plan_review_skips),
      auto_approvals: sum((stats) => stats.auto_approvals),
      reviews: sum((stats) => stats.reviews.consolidated + stats.reviews.closure + stats.reviews.gateway_b_delta),
      blocked_reviews: sum((stats) => stats.reviews.blocked),
      test_verifications_blocked: sum((stats) => stats.test_verifications.blocked),
      findings,
    },
  };
}
