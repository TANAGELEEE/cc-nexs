import assert from 'node:assert/strict';
import test from 'node:test';

import { isGitMutation, normalizeRole, roleBoundaryViolation } from './role-boundary.mjs';

test('Pi package-qualified roles resolve to core boundary roles', () => {
  assert.equal(normalizeRole('cc-nexs.reviewer'), 'reviewer');
  assert.equal(normalizeRole('developer'), 'tech-lead');
  assert.equal(normalizeRole('cc-nexs.verifier-computer-use'), 'verifier');
  assert.equal(normalizeRole('cc-nexs.lean-verifier-computer-use'), 'lean-verifier');
  assert.equal(normalizeRole('cc-nexs.hotfix-verifier-computer-use'), 'hotfix-verifier');
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

test('Lean planning and evidence roles write only their two-document contract', () => {
  assert.equal(roleBoundaryViolation({ role: 'lean-planner', toolName: 'write', filePath: 'docs/doc/01/plan.md' }), null);
  assert.match(roleBoundaryViolation({ role: 'lean-planner', toolName: 'write', filePath: 'docs/doc/01/notes.md' }), /write denied/);
  assert.equal(roleBoundaryViolation({ role: 'lean-reviewer', toolName: 'edit', filePath: 'docs/doc/01/plan.md' }), null);
  assert.match(roleBoundaryViolation({ role: 'lean-reviewer', toolName: 'write', filePath: 'docs/doc/01/review.md' }), /write denied/);
  assert.match(roleBoundaryViolation({ role: 'lean-verifier', toolName: 'write', filePath: 'docs/doc/01/test-report.md' }), /write denied/);
});
