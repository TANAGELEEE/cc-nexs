import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRoleRuntime } from './runtime-resolver.mjs';

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

test('fixed model ids are rejected instead of breaking on channel switches', () => {
  const configured = structuredClone(preset);
  configured.roles.definitions.reviewer.model = 'gpt-fixed';
  assert.throws(() => resolveRoleRuntime(configured, 'reviewer', 'claude'), /fixed model ids are not portable/);
});
