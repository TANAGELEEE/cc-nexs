// `cc-nexs dispatch` resolves the model and effort for the roles about to be dispatched,
// from the same snapshot the run loop describes: workspace config, feature config.json,
// progress and plan. It wraps the model gateway's prepare/start so an Orchestrator needs
// no request file and never imports controller modules to assemble one.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { findWorkspaceRoot, loadCandidateConfig } from './candidate-context.mjs';
import { modelGateway } from './model-gateway.mjs';
import { readProgressV2 } from './progress-v2.mjs';
import { detectRuntime } from './runtime-resolver.mjs';

function gatewayBase({ cwd, featureId, progressPath, runtime, context }) {
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const root = findWorkspaceRoot(cwd, progressFile);
  return { progressFile, root, base: { runtime, context: context || `${runtime}:default` } };
}

export function dispatchRoles({ cwd = process.cwd(), featureId, progressPath = null, runtime = detectRuntime(), roles = [], difficulty = 'routine', reason, context = null } = {}) {
  if (!roles.length) throw new Error('[cc-nexs] dispatch requires at least one --role');
  if (!reason?.trim()) throw new Error('[cc-nexs] dispatch requires --reason describing the task');
  const { progressFile, root, base } = gatewayBase({ cwd, featureId, progressPath, runtime, context });
  const config = loadCandidateConfig(root);
  const progress = readProgressV2(progressFile);
  const directory = dirname(progressFile);
  const featureConfig = existsSync(join(directory, 'config.json')) ? JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8')) : {};
  const planText = progress.mode === 'lean' && existsSync(join(directory, 'plan.md')) ? readFileSync(join(directory, 'plan.md'), 'utf8') : '';
  const prepared = modelGateway('prepare', {
    ...base,
    preset: config.preset,
    tasks: roles.map((role) => ({ role, difficulty, reason })),
    options: { models: config.mergedModels, featureConfig, progress, planText },
  }, { cwd: root });
  const started = modelGateway('start', { ...base, batchId: prepared.batch.id }, { cwd: root });
  return {
    kind: 'dispatch', feature: progress.feature, runtime, batch: started.batch.id, preview: prepared.showPreview ? prepared.preview : null,
    rows: started.batch.rows.map((row) => ({
      role: row.role, model: row.selection.model, effort: row.selection.effort,
      fallback_models: row.selection.fallback_models || [], source: row.source,
    })),
  };
}

export function recordDispatchResult({ cwd = process.cwd(), featureId, progressPath = null, runtime = detectRuntime(), batchId, role, outcome, evidence, context = null } = {}) {
  if (!batchId || !role) throw new Error('[cc-nexs] dispatch-result requires --batch and --role');
  const { root, base } = gatewayBase({ cwd, featureId, progressPath, runtime, context });
  const result = modelGateway('result', { ...base, batchId, role, outcome, evidence }, { cwd: root });
  return { kind: 'dispatch-result', batch: batchId, role, outcome: result.batch.results[role].outcome };
}
