import assert from 'node:assert/strict';
import test from 'node:test';

import { detectRuntime, resolveRoleRuntime } from './runtime-resolver.mjs';

const preset = {
  roles: { definitions: {
    implementer: { tool: 'claude-subagent', agent: 'agents/implementer.md' },
    reviewer: { tool: 'codex', agent: 'agents/reviewer.md' },
  } },
};

test('Claude keeps declared tools while Codex uses only native isolated agents', () => {
  assert.equal(resolveRoleRuntime(preset, 'implementer', 'claude').tool, 'claude-subagent');
  assert.equal(resolveRoleRuntime(preset, 'reviewer', 'claude').tool, 'codex');
  const codexReviewer = resolveRoleRuntime(preset, 'reviewer', 'codex');
  assert.equal(codexReviewer.tool, 'native-agent');
  assert.equal(codexReviewer.session_isolation, 'independent');
  assert.equal(codexReviewer.model, 'inherit');
});

test('Claude runtime overrides can keep every Lean role in native Claude subagents', () => {
  const leanPreset = {
    roles: { definitions: { reviewer: { tool: 'codex', agent: 'agents/reviewer.md' } } },
    runtimes: { claude: { roles: { reviewer: { tool: 'claude-subagent' } } } },
    models: { profiles: { review: { claude: { model: 'review-model', effort: 'high' } } }, roles: { reviewer: 'review' } },
  };
  const reviewer = resolveRoleRuntime(leanPreset, 'reviewer', 'claude');
  assert.equal(reviewer.tool, 'claude-subagent');
  assert.equal(reviewer.model_runtime, 'claude');
  assert.equal(reviewer.model, 'review-model');
  assert.equal(reviewer.effort, 'high');
});

test('Claude-hosted external Codex roles resolve Codex model profiles', () => {
  const models = {
    profiles: { review: {
      claude: { model: 'claude-model', effort: 'medium' },
      codex: { model: 'codex-review-model', effort: 'high' },
    } },
    roles: { reviewer: 'review' },
  };
  const reviewer = resolveRoleRuntime(preset, 'reviewer', 'claude', { models });
  assert.equal(reviewer.model_runtime, 'codex');
  assert.equal(reviewer.model, 'codex-review-model');
});

test('Pi maps every role to an isolated pi-subagents role without a fixed model', () => {
  const implementer = resolveRoleRuntime(preset, 'implementer', 'pi');
  const reviewer = resolveRoleRuntime(preset, 'reviewer', 'pi');
  assert.equal(implementer.tool, 'pi-subagent');
  assert.equal(reviewer.tool, 'pi-subagent');
  assert.equal(reviewer.session_isolation, 'independent');
  assert.equal(reviewer.model, 'inherit');
  assert.equal(detectRuntime({ PI_SUBAGENT_CHILD: '1' }), 'pi');
  assert.equal(detectRuntime({ PI_CODING_AGENT_DIR: '/tmp/pi-config' }), 'claude');
});

test('lean roles can select different models or different effort on the same model', () => {
  const models = {
    roles: { implementer: 'economy', reviewer: 'review' },
    profiles: {
      economy: { codex: { model: 'shared-model', effort: 'medium' } },
      review: { codex: { model: 'shared-model', effort: 'high' } },
    },
  };
  const implementer = resolveRoleRuntime(preset, 'implementer', 'codex', { models });
  const reviewer = resolveRoleRuntime(preset, 'reviewer', 'codex', { models });
  assert.equal(implementer.model, 'shared-model');
  assert.equal(implementer.effort, 'medium');
  assert.equal(reviewer.model, 'shared-model');
  assert.equal(reviewer.effort, 'high');
});

test('runtime model profiles support distinct models and Pi fallback chains', () => {
  const models = {
    roles: { reviewer: 'review' },
    profiles: {
      review: { pi: { model: 'provider/reviewer', thinking: 'high', fallbackModels: ['provider/backup'] } },
    },
  };
  const reviewer = resolveRoleRuntime(preset, 'reviewer', 'pi', { models });
  assert.equal(reviewer.model, 'provider/reviewer');
  assert.equal(reviewer.effort, 'high');
  assert.deepEqual(reviewer.fallback_models, ['provider/backup']);
});

test('high-risk Lean roles are automatically upgraded by model routing', () => {
  const models = {
    profiles: {
      daily: { codex: { model: 'daily-model', effort: 'medium' } },
      escalated: { codex: { model: 'escalated-model', effort: 'xhigh' } },
    },
    roles: { implementer: 'daily', reviewer: 'daily' },
    routing: {
      rules: [{
        id: 'lean-high-risk',
        when: { modes: ['lean'], risk_tiers: ['high', 'critical'] },
        roles: { reviewer: 'escalated' },
      }],
    },
  };
  const reviewer = resolveRoleRuntime(preset, 'reviewer', 'codex', {
    models,
    modelContext: { mode: 'lean', risk_tier: 'high', source: 'plan' },
  });
  assert.equal(reviewer.model_profile, 'escalated');
  assert.equal(reviewer.model, 'escalated-model');
  assert.equal(reviewer.effort, 'xhigh');
  assert.deepEqual(reviewer.model_routing.matched_rules, ['lean-high-risk']);
  assert.equal(reviewer.model_routing.auto_upgraded, true);
});

test('feature role model selection overrides an automatic upgrade', () => {
  const models = {
    profiles: {
      daily: { codex: { model: 'daily-model', effort: 'medium' } },
      escalated: { codex: { model: 'escalated-model', effort: 'xhigh' } },
    },
    roles: { reviewer: 'daily' },
    routing: {
      rules: [{
        id: 'hotfix-p0-p1',
        when: { modes: ['hotfix'], severities: ['P0', 'P1'] },
        roles: { reviewer: 'escalated' },
      }],
    },
  };
  const reviewer = resolveRoleRuntime(preset, 'reviewer', 'codex', {
    models,
    featureModels: { roles: { reviewer: { profile: 'daily', codex: { effort: 'high' } } } },
    modelContext: { mode: 'hotfix', risk_tier: 'critical', severity: 'P0' },
  });
  assert.equal(reviewer.model_profile, 'daily');
  assert.equal(reviewer.model, 'daily-model');
  assert.equal(reviewer.effort, 'high');
  assert.equal(reviewer.model_routing.auto_upgraded, false);
  assert.equal(reviewer.model_routing.feature_override, true);
  assert.equal(reviewer.model_routing.feature_profile_override, true);
});

test('runtime-only feature tuning preserves automatic upgrade observability', () => {
  const models = {
    profiles: {
      review: { codex: { model: 'review-model', effort: 'high' } },
      escalated: { codex: { model: 'escalated-model', effort: 'xhigh' } },
    },
    roles: { reviewer: 'review' },
    routing: { rules: [{
      id: 'lean-high',
      when: { modes: ['lean'], risk_tiers: ['high'] },
      roles: { reviewer: 'escalated' },
    }] },
  };
  const reviewer = resolveRoleRuntime(preset, 'reviewer', 'codex', {
    models,
    featureConfig: { mode: 'lean', models: { roles: { reviewer: { codex: { effort: 'max' } } } } },
    progress: { mode: 'lean' },
    planText: '- risk_tier: high\n',
  });
  assert.equal(reviewer.model_profile, 'escalated');
  assert.equal(reviewer.effort, 'max');
  assert.equal(reviewer.model_routing.auto_upgraded, true);
  assert.equal(reviewer.model_routing.feature_override, true);
  assert.equal(reviewer.model_routing.feature_profile_override, false);
});

test('feature role profile typos fail closed instead of silently inheriting the host model', () => {
  assert.throws(() => resolveRoleRuntime(preset, 'reviewer', 'codex', {
    models: { profiles: { review: { codex: { effort: 'high' } } }, roles: { reviewer: 'review' } },
    featureConfig: { mode: 'lean', models: { roles: { reviewer: 'typo-profile' } } },
    progress: { mode: 'lean' },
  }), /unknown model profile: typo-profile/);
});
