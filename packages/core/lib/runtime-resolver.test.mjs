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
