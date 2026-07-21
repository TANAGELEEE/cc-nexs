import assert from 'node:assert/strict';
import test from 'node:test';

import { detectRuntime, resolveRoleRuntime } from './runtime-resolver.mjs';

const preset = {
  roles: { definitions: {
    implementer: { tool: 'claude-subagent', agent: 'agents/implementer.md' },
    reviewer: { tool: 'codex', agent: 'agents/reviewer.md' },
  } },
};

test('Claude keeps heterogeneous tools while Codex uses only native isolated agents', () => {
  assert.equal(resolveRoleRuntime(preset, 'implementer', 'claude').tool, 'claude-subagent');
  assert.equal(resolveRoleRuntime(preset, 'reviewer', 'claude').tool, 'codex');
  const codexReviewer = resolveRoleRuntime(preset, 'reviewer', 'codex');
  assert.equal(codexReviewer.tool, 'native-agent');
  assert.equal(codexReviewer.session_isolation, 'independent');
  assert.equal(codexReviewer.model, 'inherit');
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

test('fixed model ids are rejected instead of breaking on channel switches', () => {
  const configured = structuredClone(preset);
  configured.roles.definitions.reviewer.model = 'gpt-fixed';
  assert.throws(() => resolveRoleRuntime(configured, 'reviewer', 'claude'), /fixed model ids are not portable/);
});
