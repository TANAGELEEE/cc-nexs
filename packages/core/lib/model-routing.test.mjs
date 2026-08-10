import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  applyModelRouting,
  extractPlanRiskTier,
  hasLegacyTemplateRoleMap,
  resolveRiskContext,
  resolveFeatureModelRouting,
} from './model-routing.mjs';

const baseModels = {
  profiles: {
    balanced: { codex: { model: 'daily-model', effort: 'medium' } },
    review: { codex: { model: 'review-model', effort: 'high' } },
    escalated: { codex: { model: 'critical-model', effort: 'xhigh' } },
  },
  roles: {
    'lean-planner': 'balanced',
    'lean-developer': 'balanced',
    'lean-reviewer': 'review',
    'hotfix-reviewer': 'review',
  },
  routing: {
    enabled: true,
    default_risk_tier: 'medium',
    rules: [
      {
        id: 'lean-high-risk',
        when: { modes: ['lean'], risk_tiers: ['high', 'critical'] },
        roles: { 'lean-planner': 'escalated', 'lean-reviewer': 'escalated' },
      },
      {
        id: 'hotfix-p0-p1',
        when: { modes: ['hotfix'], severities: ['P0', 'P1'] },
        roles: { 'hotfix-reviewer': 'escalated' },
      },
    ],
  },
};

test('risk context takes the highest deterministic signal and maps hotfix severity', () => {
  const lean = resolveRiskContext({
    featureConfig: { mode: 'lean', risk_tier: 'low' },
    progress: { mode: 'lean' },
    planText: '- risk_tier: high\n',
  });
  assert.equal(lean.risk_tier, 'high');
  assert.equal(lean.source, 'plan');

  const hotfix = resolveRiskContext({
    featureConfig: { mode: 'hotfix', risk_tier: 'low' },
    progress: { mode: 'hotfix', hotfix: { severity: 'P0' } },
  });
  assert.equal(hotfix.risk_tier, 'critical');
  assert.equal(hotfix.source, 'hotfix_severity');
});

test('plan risk parser supports machine-friendly and legacy localized fields', () => {
  assert.equal(extractPlanRiskTier('- risk_tier: critical\n'), 'critical');
  assert.equal(extractPlanRiskTier('- 风险等级（risk_tier）：高\n'), 'high');
  assert.equal(extractPlanRiskTier('- 风险等级：低\n'), 'low');
});

test('matching routing rules upgrade selected roles while daily roles stay unchanged', () => {
  const routed = applyModelRouting(baseModels, {}, { mode: 'lean', risk_tier: 'high', severity: null, source: 'plan' });
  assert.equal(routed.models.roles['lean-planner'], 'escalated');
  assert.equal(routed.models.roles['lean-reviewer'], 'escalated');
  assert.equal(routed.models.roles['lean-developer'], 'balanced');
  assert.deepEqual(routed.decision.matched_rules.map((item) => item.id), ['lean-high-risk']);
});

test('feature role overrides remain the final authority after automatic routing', () => {
  const routed = applyModelRouting(baseModels, {
    roles: { 'lean-reviewer': { profile: 'review', codex: { effort: 'max' } } },
  }, { mode: 'lean', risk_tier: 'critical', severity: null });
  assert.deepEqual(routed.models.roles['lean-reviewer'], { profile: 'review', codex: { effort: 'max' } });
  assert.equal(routed.models.roles['lean-planner'], 'escalated');
  assert.deepEqual(routed.decision.feature_role_overrides, ['lean-reviewer']);
});

test('a feature runtime-only override keeps the automatically routed profile', () => {
  const routed = applyModelRouting(baseModels, {
    roles: { 'lean-reviewer': { codex: { effort: 'max' } } },
  }, { mode: 'lean', risk_tier: 'high' });
  assert.deepEqual(routed.models.roles['lean-reviewer'], {
    profile: 'escalated',
    codex: { effort: 'max' },
  });
});

test('a routing rule runtime-only override layers on the current profile', () => {
  const models = structuredClone(baseModels);
  models.routing.rules = [{
    id: 'review-effort-only',
    when: { modes: ['lean'], risk_tiers: ['high'] },
    roles: { 'lean-reviewer': { codex: { effort: 'xhigh' } } },
  }];
  const routed = applyModelRouting(models, {}, { mode: 'lean', risk_tier: 'high' });
  assert.deepEqual(routed.models.roles['lean-reviewer'], {
    profile: 'review',
    codex: { effort: 'xhigh' },
  });
});

test('high-level feature routing derives risk context from approved document inputs', () => {
  const routed = resolveFeatureModelRouting({
    models: baseModels,
    featureConfig: { mode: 'lean', risk_tier: 'auto' },
    progress: { mode: 'lean' },
    planText: '- risk_tier: high\n',
  });
  assert.equal(routed.context.source, 'plan');
  assert.equal(routed.models.roles['lean-planner'], 'escalated');
});

test('approved Gateway A risk takes precedence over mutable plan text', () => {
  const routed = resolveFeatureModelRouting({
    models: baseModels,
    featureConfig: { mode: 'lean', risk_tier: 'auto' },
    progress: {
      mode: 'lean',
      gates: { plan: { approved: true, binding: { risk_tier: 'high' } } },
    },
    planText: '- risk_tier: low\n',
  });
  assert.equal(routed.context.risk_tier, 'high');
  assert.equal(routed.context.source, 'gateway_a_binding');
});

test('legacy approved plans derive risk only from the exact hashed approval scope', () => {
  const planText = '<!-- APPROVAL-SCOPE START -->\n- risk_tier: critical\n<!-- APPROVAL-SCOPE END -->\n';
  const planScope = '\n- risk_tier: critical\n';
  const routed = resolveFeatureModelRouting({
    models: baseModels,
    featureConfig: { mode: 'lean', risk_tier: 'low' },
    progress: { mode: 'lean', gates: { plan: { approved: true, binding: {
      plan_scope_sha256: createHash('sha256').update(planScope).digest('hex'),
    } } } },
    planText,
  });
  assert.equal(routed.context.risk_tier, 'critical');
  assert.equal(routed.context.source, 'gateway_a_hashed_scope_derived');
  assert.equal(routed.context.plan_binding_status, 'derived');
  assert.equal(routed.models.roles['lean-reviewer'], 'escalated');
});

test('unknown or stale legacy Gateway A risk uses a conservative high floor', () => {
  const routed = resolveFeatureModelRouting({
    models: baseModels,
    featureConfig: { mode: 'lean', risk_tier: 'low' },
    progress: { mode: 'lean', gates: { plan: { approved: true, binding: {} } } },
    planText: '<!-- APPROVAL-SCOPE START -->\n- risk_tier: critical\n<!-- APPROVAL-SCOPE END -->\n',
  });
  assert.equal(routed.context.risk_tier, 'high');
  assert.equal(routed.context.source, 'legacy_gateway_a_unknown');
  assert.equal(routed.context.plan_binding_status, 'unknown');
  assert.equal(routed.models.roles['lean-reviewer'], 'escalated');
});

test('feature routing may override the default risk tier without defining a role override', () => {
  const routed = resolveFeatureModelRouting({
    models: baseModels,
    featureConfig: {
      mode: 'lean',
      risk_tier: 'auto',
      models: { routing: { default_risk_tier: 'high' } },
    },
    progress: { mode: 'lean' },
  });
  assert.equal(routed.context.risk_tier, 'high');
  assert.equal(routed.models.roles['lean-reviewer'], 'escalated');
});

test('hotfix P0/P1 routes reviewer but P2 remains on the daily profile', () => {
  const p1 = applyModelRouting(baseModels, {}, { mode: 'hotfix', risk_tier: 'high', severity: 'P1' });
  assert.equal(p1.models.roles['hotfix-reviewer'], 'escalated');
  const p2 = applyModelRouting(baseModels, {}, { mode: 'hotfix', risk_tier: 'medium', severity: 'P2' });
  assert.equal(p2.models.roles['hotfix-reviewer'], 'review');
});

test('routing can be explicitly disabled and matching rules apply in declared order', () => {
  const disabled = applyModelRouting(baseModels, { routing: { enabled: false } }, {
    mode: 'lean', risk_tier: 'critical',
  });
  assert.equal(disabled.models.roles['lean-reviewer'], 'review');
  assert.deepEqual(disabled.decision.matched_rules, []);

  const orderedModels = structuredClone(baseModels);
  orderedModels.routing.rules.push({
    id: 'critical-review-policy',
    when: { modes: ['lean'], risk_tiers: ['critical'] },
    roles: { 'lean-reviewer': 'review' },
  });
  const ordered = applyModelRouting(orderedModels, {}, { mode: 'lean', risk_tier: 'critical' });
  assert.equal(ordered.models.roles['lean-reviewer'], 'review');
  assert.deepEqual(ordered.decision.matched_rules.map((item) => item.id), [
    'lean-high-risk', 'critical-review-policy',
  ]);
});

test('legacy template role maps are detected only when the complete generated map is unchanged', () => {
  assert.equal(hasLegacyTemplateRoleMap({
    mode: 'lean',
    models: { roles: {
      'lean-planner': 'balanced',
      'lean-developer': 'balanced',
      'lean-reviewer': 'review',
      'lean-verifier': 'balanced',
    } },
  }), true);
  assert.equal(hasLegacyTemplateRoleMap({
    mode: 'lean',
    models: { roles: { 'lean-planner': 'critical' } },
  }), false);
  assert.equal(hasLegacyTemplateRoleMap({
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
  }), false);
});

test('hotfix severity is ignored outside hotfix mode and mode mismatches fail closed', () => {
  const lean = resolveRiskContext({
    featureConfig: { mode: 'lean' },
    progress: { mode: 'lean', hotfix: { severity: 'P0' } },
  });
  assert.equal(lean.risk_tier, 'medium');
  assert.equal(lean.severity, null);
  assert.throws(() => resolveRiskContext({
    featureConfig: { mode: 'hotfix' },
    progress: { mode: 'lean' },
  }), /mode mismatch/);
  assert.throws(() => resolveRiskContext({
    featureConfig: { mode: 'LEAN' },
  }), /invalid mode/);
});

test('plan risk is ignored outside Lean mode', () => {
  const hotfix = resolveRiskContext({
    featureConfig: { mode: 'hotfix' },
    progress: { mode: 'hotfix', hotfix: { severity: 'P2' } },
    planText: '- risk_tier: critical\n',
  });
  assert.equal(hotfix.risk_tier, 'medium');
  assert.deepEqual(hotfix.signals, [{ source: 'hotfix_severity', risk_tier: 'medium' }]);
});

test('routing rejects unknown modes and profile typos', () => {
  assert.throws(() => applyModelRouting({
    profiles: {},
    routing: { rules: [{ id: 'bad-mode', when: { modes: ['unknown'] }, roles: { reviewer: 'inherit' } }] },
  }, {}, { mode: 'lean', risk_tier: 'medium' }), /invalid mode/);
  assert.throws(() => applyModelRouting({
    profiles: {},
    routing: { rules: [{ id: 'bad-profile', roles: { reviewer: 'missing' } }] },
  }, {}, { mode: 'lean', risk_tier: 'medium' }), /unknown model profile/);
  assert.throws(() => applyModelRouting({
    profiles: { escalated: {} },
    routing: { rules: [{ id: 'typo', when: { risk_tier: ['high'] }, roles: { reviewer: 'escalated' } }] },
  }, {}, { mode: 'lean', risk_tier: 'medium' }), /unknown keys: risk_tier/);
});

test('plan risk parser rejects duplicate structured fields', () => {
  assert.throws(() => extractPlanRiskTier('- risk_tier: low\n- risk_tier: critical\n'), /exactly one/);
});
