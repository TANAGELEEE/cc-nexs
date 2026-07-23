import assert from 'node:assert/strict';
import test from 'node:test';

import { isGitMutation, normalizeRole, roleBoundaryViolation } from './role-boundary.mjs';

test('Pi package-qualified roles resolve to core boundary roles', () => {
  assert.equal(normalizeRole('cc-nexs.reviewer'), 'reviewer');
  assert.equal(normalizeRole('developer'), 'tech-lead');
});

test('reviewer and verifier black-box reads are blocked', () => {
  assert.match(roleBoundaryViolation({ role: 'cc-nexs.reviewer', toolName: 'read', filePath: 'api/src/main.ts' }), /cannot read src/);
  assert.match(roleBoundaryViolation({ role: 'cc-nexs.verifier', toolName: 'read', filePath: 'all-docs/doc/01/sa-review.md' }), /black-box/);
});

test('fullstack cannot mutate orchestrator-owned artifacts', () => {
  assert.match(roleBoundaryViolation({ role: 'cc-nexs.fullstack', toolName: 'write', filePath: 'all-docs/doc/01/progress.md' }), /cannot edit/);
  assert.equal(roleBoundaryViolation({ role: 'cc-nexs.fullstack', toolName: 'edit', filePath: 'api/src/main.ts' }), null);
});

test('planner blocks the Codex executable without mistaking .codex paths for commands', () => {
  assert.match(roleBoundaryViolation({ role: 'planner', command: 'codex exec review' }), /cannot write code/);
  assert.match(roleBoundaryViolation({ role: 'planner', command: 'cd repo && codex exec review' }), /cannot write code/);
  assert.equal(roleBoundaryViolation({ role: 'planner', command: "sed -n '1,40p' /tmp/.codex/skills/demo/SKILL.md" }), null);
});

test('git mutation detection covers history and worktree changes', () => {
  assert.equal(isGitMutation('git status --short'), false);
  assert.equal(isGitMutation('git -C api commit -m test'), true);
  assert.equal(isGitMutation('git worktree remove .worktrees/01'), true);
});
