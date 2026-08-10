import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { migrateFeatureConfig } from './feature-config.mjs';
import { planApprovalBinding } from './plan-contract.mjs';
import { createProgressV2, readProgressV2, writeProgressV2 } from './progress-v2.mjs';

function fixture(config, { mode = 'lean', id = '07' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-feature-config-'));
  const feature = join(root, 'doc', `${id}.routing`);
  mkdirSync(feature, { recursive: true });
  const progressFile = join(feature, 'progress.json');
  writeProgressV2(progressFile, createProgressV2({
    featureId: id,
    featureSlug: 'routing',
    preset: 'preset-standard',
    mode,
  }));
  writeFileSync(join(feature, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return { root, feature, progressFile };
}

function approveLegacyPlan(current, riskTier = 'high') {
  writeFileSync(join(current.feature, 'requirements.md'), '# Requirements\n');
  writeFileSync(join(current.feature, 'plan.md'), `# Plan\n\n<!-- APPROVAL-SCOPE START -->\n- risk_tier: ${riskTier}\n<!-- APPROVAL-SCOPE END -->\n`);
  const progress = readProgressV2(current.progressFile);
  const binding = planApprovalBinding(current.feature);
  delete binding.risk_tier;
  progress.gates.plan = {
    approved: true,
    approver: 'legacy-owner',
    approved_at: '2026-01-01T00:00:00.000Z',
    binding,
  };
  writeProgressV2(current.progressFile, progress);
}

test('migration removes only the unchanged generated role map and adds automatic risk', () => {
  const current = fixture({
    mode: 'lean',
    release: { test: 'inherit' },
    models: { roles: {
      'lean-planner': 'balanced',
      'lean-developer': 'balanced',
      'lean-reviewer': 'review',
      'lean-verifier': 'balanced',
    } },
  });
  try {
    const result = migrateFeatureConfig({ featureId: '07', progressPath: current.progressFile });
    assert.equal(result.removedLegacyRoles, true);
    assert.equal(result.addedRiskTier, true);
    assert.deepEqual(JSON.parse(readFileSync(join(current.feature, 'config.json'))), {
      mode: 'lean',
      release: { test: 'inherit' },
      risk_tier: 'auto',
      config_version: 2,
    });
    const second = migrateFeatureConfig({ featureId: '07', progressPath: current.progressFile });
    assert.equal(second.changed, false);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test('migration handles the unchanged generated Hotfix map', () => {
  const current = fixture({
    mode: 'hotfix',
    models: { roles: {
      'hotfix-developer': 'balanced',
      'hotfix-reviewer': 'review',
      'hotfix-verifier': 'balanced',
    } },
  }, { mode: 'hotfix', id: '09' });
  try {
    const result = migrateFeatureConfig({ featureId: '09', progressPath: current.progressFile });
    assert.equal(result.removedLegacyRoles, true);
    const config = JSON.parse(readFileSync(join(current.feature, 'config.json')));
    assert.deepEqual(config, { mode: 'hotfix', risk_tier: 'auto', config_version: 2 });
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test('migration canonicalizes localized risk and rejects future versions without writing', () => {
  const localized = fixture({ mode: 'lean', risk_tier: '高' });
  try {
    const result = migrateFeatureConfig({ featureId: '07', progressPath: localized.progressFile });
    assert.equal(result.normalizedRiskTierChanged, true);
    assert.equal(JSON.parse(readFileSync(join(localized.feature, 'config.json'))).risk_tier, 'high');
  } finally {
    rmSync(localized.root, { recursive: true, force: true });
  }

  const future = fixture({ config_version: 3, mode: 'lean', risk_tier: 'auto' });
  try {
    const configFile = join(future.feature, 'config.json');
    const before = readFileSync(configFile, 'utf8');
    assert.throws(
      () => migrateFeatureConfig({ featureId: '07', progressPath: future.progressFile }),
      /unsupported config_version/,
    );
    assert.equal(readFileSync(configFile, 'utf8'), before);
  } finally {
    rmSync(future.root, { recursive: true, force: true });
  }
});

test('migration does not infer generated roles when custom model configuration coexists', () => {
  const current = fixture({
    mode: 'lean',
    models: {
      profiles: { review: { codex: { effort: 'max' } } },
      roles: {
        'lean-planner': 'balanced',
        'lean-developer': 'balanced',
        'lean-reviewer': 'review',
        'lean-verifier': 'balanced',
      },
    },
  });
  try {
    const result = migrateFeatureConfig({ featureId: '07', progressPath: current.progressFile });
    assert.equal(result.removedLegacyRoles, false);
    const config = JSON.parse(readFileSync(join(current.feature, 'config.json')));
    assert.equal(config.models.roles['lean-reviewer'], 'review');
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test('migration preserves any explicit feature role customization', () => {
  const current = fixture({
    mode: 'lean',
    models: { roles: { 'lean-reviewer': 'custom-review' } },
  });
  try {
    const result = migrateFeatureConfig({ featureId: '07', progressPath: current.progressFile });
    assert.equal(result.removedLegacyRoles, false);
    const config = JSON.parse(readFileSync(join(current.feature, 'config.json')));
    assert.equal(config.models.roles['lean-reviewer'], 'custom-review');
    assert.equal(config.risk_tier, 'auto');
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test('dry-run reports a migration without changing config.json', () => {
  const current = fixture({ mode: 'lean' });
  try {
    const before = readFileSync(join(current.feature, 'config.json'), 'utf8');
    const result = migrateFeatureConfig({ featureId: '07', progressPath: current.progressFile, dryRun: true });
    assert.equal(result.changed, true);
    assert.equal(result.dryRun, true);
    assert.equal(readFileSync(join(current.feature, 'config.json'), 'utf8'), before);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test('legacy Gateway A risk can be explicitly backfilled from its exact approved hash', () => {
  const current = fixture({ config_version: 2, mode: 'lean', risk_tier: 'auto' });
  try {
    approveLegacyPlan(current, 'critical');
    const before = readFileSync(current.progressFile, 'utf8');

    const inspected = migrateFeatureConfig({ featureId: '07', progressPath: current.progressFile });
    assert.equal(inspected.changed, false);
    assert.equal(inspected.planRiskBindingStatus, 'derivable');
    assert.equal(inspected.planRiskTier, 'critical');
    assert.equal(readFileSync(current.progressFile, 'utf8'), before);

    const preview = migrateFeatureConfig({
      featureId: '07', progressPath: current.progressFile, bindPlanRisk: true, dryRun: true,
    });
    assert.equal(preview.changed, true);
    assert.equal(preview.planRiskBindingChanged, true);
    assert.equal(readFileSync(current.progressFile, 'utf8'), before);

    const migrated = migrateFeatureConfig({
      featureId: '07', progressPath: current.progressFile, bindPlanRisk: true,
    });
    assert.equal(migrated.planRiskBindingChanged, true);
    const progress = readProgressV2(current.progressFile);
    assert.equal(progress.gates.plan.binding.risk_tier, 'critical');
    assert.equal(progress.gates.plan.approver, 'legacy-owner');
    assert.equal(progress.events.at(-1).type, 'migration.plan_risk_binding_backfilled');
    assert.equal(progress.events.some((event) => event.type === 'gate.approved'), false);

    const second = migrateFeatureConfig({
      featureId: '07', progressPath: current.progressFile, bindPlanRisk: true,
    });
    assert.equal(second.changed, false);
    assert.equal(second.planRiskBindingStatus, 'bound');
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test('legacy Gateway A backfill refuses stale approved documents without writing', () => {
  const current = fixture({ config_version: 2, mode: 'lean', risk_tier: 'auto' });
  try {
    approveLegacyPlan(current, 'high');
    writeFileSync(join(current.feature, 'plan.md'), '# Plan\n\n<!-- APPROVAL-SCOPE START -->\n- risk_tier: low\n<!-- APPROVAL-SCOPE END -->\n');
    const configBefore = readFileSync(join(current.feature, 'config.json'), 'utf8');
    const progressBefore = readFileSync(current.progressFile, 'utf8');
    assert.throws(() => migrateFeatureConfig({
      featureId: '07', progressPath: current.progressFile, bindPlanRisk: true,
    }), /cannot bind legacy Gateway A risk: stale/);
    assert.equal(readFileSync(join(current.feature, 'config.json'), 'utf8'), configBefore);
    assert.equal(readFileSync(current.progressFile, 'utf8'), progressBefore);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test('legacy Gateway A backfill refuses a hash-matching but non-concrete risk', () => {
  const current = fixture({ config_version: 2, mode: 'lean', risk_tier: 'auto' });
  try {
    approveLegacyPlan(current, 'auto');
    const before = readFileSync(current.progressFile, 'utf8');
    assert.throws(() => migrateFeatureConfig({
      featureId: '07', progressPath: current.progressFile, bindPlanRisk: true,
    }), /cannot bind legacy Gateway A risk: unstructured/);
    assert.equal(readFileSync(current.progressFile, 'utf8'), before);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});
