import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { hasLegacyTemplateRoleMap, normalizeRiskTier } from './model-routing.mjs';
import { inspectPlanRiskBinding } from './plan-contract.mjs';
import { readProgressV2, writeProgressV2 } from './progress-v2.mjs';

export function migrateFeatureConfig({
  cwd = process.cwd(),
  featureId,
  progressPath = null,
  dryRun = false,
  bindPlanRisk = false,
} = {}) {
  if (!featureId && !progressPath) throw new Error('feature id or --progress is required');
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const progress = readProgressV2(progressFile);
  if (featureId && !sameFeatureId(progress.feature.id, featureId)) {
    throw new Error(`feature mismatch: requested ${featureId}, found ${progress.feature.id}`);
  }
  if (!['lean', 'hotfix'].includes(progress.mode)) {
    throw new Error(`feature config migration requires lean or hotfix mode, found ${progress.mode}`);
  }

  const configFile = join(dirname(progressFile), 'config.json');
  if (!existsSync(configFile)) throw new Error(`config.json is missing beside ${progressFile}`);
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const configuredMode = config.mode || 'lean';
  if (configuredMode !== progress.mode) {
    throw new Error(`config mode ${configuredMode} != progress mode ${progress.mode}`);
  }

  const riskTierWasMissing = config.risk_tier === undefined;
  const normalizedRiskTier = normalizeRiskTier(config.risk_tier);
  const normalizedRiskTierChanged = config.risk_tier !== normalizedRiskTier;
  if (normalizedRiskTierChanged) config.risk_tier = normalizedRiskTier;
  if (config.config_version !== undefined
    && (!Number.isInteger(config.config_version) || config.config_version < 1 || config.config_version > 2)) {
    throw new Error(`unsupported config_version: ${config.config_version}`);
  }
  const removedLegacyRoles = hasLegacyTemplateRoleMap(config, progress.mode);
  if (removedLegacyRoles) {
    delete config.models.roles;
    if (Object.keys(config.models).length === 0) delete config.models;
  }
  const addedRiskTier = riskTierWasMissing;
  const upgradedConfigVersion = config.config_version !== 2;
  if (upgradedConfigVersion) config.config_version = 2;
  const configChanged = removedLegacyRoles || normalizedRiskTierChanged || upgradedConfigVersion;
  const planRiskBinding = inspectLegacyPlanRiskBinding(progress, dirname(progressFile));
  if (bindPlanRisk && !['bound', 'derivable'].includes(planRiskBinding.status)) {
    throw new Error(`cannot bind legacy Gateway A risk: ${planRiskBinding.status}${planRiskBinding.error ? ` (${planRiskBinding.error})` : ''}`);
  }
  const planRiskBindingChanged = bindPlanRisk && planRiskBinding.status === 'derivable';
  const changed = configChanged || planRiskBindingChanged;

  if (!dryRun && planRiskBindingChanged) {
    const latest = readProgressV2(progressFile);
    if (latest.revision !== progress.revision) {
      throw new Error(`stale progress revision: expected ${progress.revision}, found ${latest.revision}`);
    }
    const migrated = structuredClone(progress);
    migrated.gates.plan.binding.risk_tier = planRiskBinding.risk_tier;
    migrated.revision += 1;
    migrated.updated_at = new Date().toISOString();
    migrated.events.push({
      id: randomUUID(),
      sequence: migrated.revision,
      timestamp: migrated.updated_at,
      type: 'migration.plan_risk_binding_backfilled',
      actor: 'cc-nexs-migration',
      data: {
        risk_tier: planRiskBinding.risk_tier,
        source: 'approved_plan_scope_hash',
      },
    });
    writeProgressV2(progressFile, migrated);
  }
  if (configChanged && !dryRun) writeJsonAtomic(configFile, config);
  return {
    kind: 'feature-config-migration',
    feature: progress.feature,
    mode: progress.mode,
    state: progress.state,
    changed,
    dryRun,
    removedLegacyRoles,
    addedRiskTier,
    normalizedRiskTierChanged,
    upgradedConfigVersion,
    configChanged,
    planRiskBindingStatus: planRiskBinding.status,
    planRiskTier: planRiskBinding.risk_tier,
    planRiskBindingChanged,
    ...(planRiskBinding.error && { planRiskBindingError: planRiskBinding.error }),
    configFile,
    progressFile,
  };
}

function inspectLegacyPlanRiskBinding(progress, reqDir) {
  try {
    return inspectPlanRiskBinding(progress, reqDir);
  } catch (error) {
    return { status: 'stale', risk_tier: null, error: error.message };
  }
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.cc-nexs-migrate-${randomUUID()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: statSync(file).mode & 0o777,
      flag: 'wx',
    });
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function sameFeatureId(left, right) {
  const a = String(left);
  const b = String(right);
  return /^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) === Number(b) : a === b;
}
