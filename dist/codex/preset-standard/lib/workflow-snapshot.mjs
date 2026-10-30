import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { findWorkspaceRoot } from './candidate-context.mjs';
import { loadConfig } from './config-loader.mjs';
import { configuredPluginRoot } from './config-root.mjs';
import { transitionState } from './progress-io.mjs';
import { readProgressV2 } from './progress-v2.mjs';
import { nextStep } from './state-machine.mjs';
import { resolveTestReleasePolicy } from './test-release.mjs';

/** Build the nextStep() input that commands/run.md describes, from authoritative progress and config. */
export function buildWorkflowSnapshot({ cwd = process.cwd(), featureId, progressPath = null, noAutoTestRelease = false } = {}) {
  if (!featureId) throw new Error('feature id is required');
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  let projectRoot = cwd;
  try { projectRoot = findWorkspaceRoot(cwd, progressFile); } catch {}
  const pluginRoot = configuredPluginRoot();
  const config = loadConfig({ projectRoot, ...(pluginRoot && { presetRoot: pluginRoot }) });
  const progress = readProgressV2(progressFile);
  const featureConfig = readFeatureConfig(progressFile);
  const mode = progress.mode;

  const persistedPolicy = resolveTestReleasePolicy({
    progress,
    featureConfig,
    configured: config.mergedWorkflow?.test_release?.policy,
    configuredOverride: config.project?.workflow?.test_release?.policy ?? config.overlay?.workflow?.test_release?.policy,
  });
  const latestLocalAttempt = progress.local_verification?.attempts?.findLast((item) => (
    item.fingerprint === progress.local_verification?.candidate_fingerprint
  ));
  const exactRecordedReview = ['passed', 'blocked'].includes(progress.review?.status)
    && progress.review?.candidate_fingerprint === progress.local_verification?.candidate_fingerprint
    && latestLocalAttempt?.fingerprint === progress.review?.candidate_fingerprint;
  const testAttempts = progress.delivery?.test?.attempts || [];
  const workflow = {
    plan_approved: progress.gates?.plan?.approved === true,
    delivery_lane: progress.gates?.plan?.binding?.delivery_lane || 'standard',
    release_approved: progress.gates?.release?.approved === true,
    hotfix: progress.hotfix ? {
      ...progress.hotfix,
      delta_attempts: progress.review?.closure_attempts || 0,
    } : null,
    local_verification: {
      status: progress.local_verification?.status || 'idle',
      context: progress.local_verification?.context || null,
    },
    review: {
      status: progress.review?.status || 'idle',
      exact: exactRecordedReview,
      closure_attempts: progress.review?.closure_attempts || 0,
      gateway_b_delta_attempts: progress.review?.gateway_b_delta_attempts || 0,
    },
    test_release: {
      policy: noAutoTestRelease ? 'manual' : persistedPolicy,
      status: progress.delivery?.test?.status || 'idle',
      attempt: testAttempts.filter((item) => item.deployment && item.environment_revision).length,
      prerequisites_met: true,
    },
    base_release: {
      status: progress.delivery?.base?.status || 'idle',
      attempt: progress.delivery?.base?.attempts?.length || 0,
    },
  };
  const modeConfig = config.preset?.modes?.[mode];
  return {
    progressFile,
    feature: progress.feature,
    revision: progress.revision,
    input: {
      state: progress.state,
      counters: progress.counters || {},
      thresholds: config.mergedThresholds,
      enabledRoles: modeConfig?.enabled || config.preset?.roles?.enabled || [],
      humanGateApproved: workflow.plan_approved,
      workflow,
      mode,
    },
  };
}

export function featureStatus(options = {}) {
  const snapshot = buildWorkflowSnapshot(options);
  return { kind: 'feature-status', ...snapshot, next: nextStep(snapshot.input) };
}

/** CLI form of the run loop's persist step: move from the captured state to effectiveNext exactly once. */
export function advanceFeatureState({ cwd = process.cwd(), featureId, progressPath = null, from, to, reason = '' } = {}) {
  if (!from || !to) throw new Error('advance requires --from <state> and --to <state>');
  if (from === to) throw new Error(`[cc-nexs] advance target equals the current state ${from}; nothing to persist`);
  const status = featureStatus({ cwd, featureId, progressPath });
  const markdown = join(dirname(status.progressFile), 'progress.md');
  if (!existsSync(markdown)) throw new Error(`[cc-nexs] progress.md not found beside ${status.progressFile}`);
  transitionState(markdown, { from, to, reason });
  const progress = readProgressV2(status.progressFile);
  return {
    kind: 'feature-advance',
    feature: progress.feature,
    from,
    to: progress.state,
    revision: progress.revision,
    expectedNext: status.input.state === from ? status.next.next : null,
    progressFile: status.progressFile,
  };
}

function readFeatureConfig(progressFile) {
  const file = join(dirname(progressFile), 'config.json');
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`[cc-nexs] invalid feature config: ${file}`); }
}
