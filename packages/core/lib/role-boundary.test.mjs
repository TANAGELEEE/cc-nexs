import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isGitMutation,
  isProgressMutation,
  normalizeRole,
  roleBoundaryViolation,
} from './role-boundary.mjs';

test('Pi package-qualified roles resolve to core boundary roles', () => {
  assert.equal(normalizeRole('cc-nexs.reviewer'), 'reviewer');
  assert.equal(normalizeRole('developer'), 'tech-lead');
  assert.equal(normalizeRole('cc-nexs.verifier-computer-use'), 'verifier');
  assert.equal(normalizeRole('cc-nexs.sa'), 'sa');
  assert.equal(normalizeRole('cc-nexs.qa-computer-use'), 'qa');
  assert.equal(normalizeRole('cc-nexs.lean-verifier-computer-use'), 'lean-verifier');
  assert.equal(normalizeRole('cc-nexs.hotfix-verifier-computer-use'), 'hotfix-verifier');
});

test('reviewer and verifier black-box reads are blocked', () => {
  assert.match(roleBoundaryViolation({ role: 'cc-nexs.reviewer', toolName: 'read', filePath: 'api/src/main.ts' }), /cannot read src/);
  assert.match(roleBoundaryViolation({ role: 'cc-nexs.verifier', toolName: 'read', filePath: 'all-docs/doc/01/sa-review.md' }), /black-box/);
});

test('fullstack cannot mutate orchestrator-owned artifacts', () => {
  assert.match(roleBoundaryViolation({ role: 'cc-nexs.fullstack', toolName: 'write', filePath: 'all-docs/doc/01/progress.md' }), /cannot edit/);
  assert.match(roleBoundaryViolation({ role: 'cc-nexs.fullstack', toolName: 'write', filePath: 'all-docs/doc/01/progress.json' }), /cannot edit/);
  assert.equal(roleBoundaryViolation({ role: 'cc-nexs.fullstack', toolName: 'edit', filePath: 'api/src/main.ts' }), null);
});

test('tech lead cannot mutate authoritative progress', () => {
  assert.match(roleBoundaryViolation({ role: 'cc-nexs.tech-lead', toolName: 'edit', filePath: 'all-docs/doc/01/progress.json' }), /cannot edit/);
});

test('SA writes only its review artifacts and never authoritative progress', () => {
  assert.equal(roleBoundaryViolation({ role: 'cc-nexs.sa', toolName: 'write', filePath: 'all-docs/doc/01/sa-review.md' }), null);
  assert.equal(roleBoundaryViolation({ role: 'cc-nexs.sa', toolName: 'edit', filePath: 'all-docs/doc/01/sa-test-review.md' }), null);
  assert.equal(roleBoundaryViolation({ role: 'cc-nexs.sa', toolName: 'write', filePath: 'all-docs/doc/01/sa-code-review.md' }), null);
  assert.match(roleBoundaryViolation({ role: 'cc-nexs.sa', toolName: 'write', filePath: 'all-docs/doc/01/progress.md' }), /write denied/);
  assert.match(roleBoundaryViolation({ role: 'cc-nexs.sa', toolName: 'edit', filePath: 'all-docs/doc/01/progress.json' }), /write denied/);
  assert.match(roleBoundaryViolation({ role: 'cc-nexs.sa', toolName: 'write', filePath: 'all-docs/doc/01/test-report.md' }), /write denied/);
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

test('progress mutation detection blocks shell writes but allows inspection', () => {
  assert.equal(isProgressMutation("cat all-docs/doc/01/progress.md"), false);
  assert.equal(isProgressMutation("rg 'state' all-docs/doc/01/progress.json"), false);
  assert.equal(isProgressMutation("printf '%s' ok > all-docs/doc/01/progress.md"), true);
  assert.equal(isProgressMutation("jq '.state = \"BUILD\"' progress.json | tee progress.json"), true);
  assert.equal(isProgressMutation("sed -i '' 's/A/B/' ./progress.md"), true);
});

test('Lean planning and evidence roles write only their two-document contract', () => {
  assert.equal(roleBoundaryViolation({ role: 'lean-planner', toolName: 'write', filePath: 'docs/doc/01/plan.md' }), null);
  assert.match(roleBoundaryViolation({ role: 'lean-planner', toolName: 'write', filePath: 'docs/doc/01/notes.md' }), /write denied/);
  assert.equal(roleBoundaryViolation({ role: 'lean-reviewer', toolName: 'edit', filePath: 'docs/doc/01/plan.md' }), null);
  assert.match(roleBoundaryViolation({ role: 'lean-reviewer', toolName: 'write', filePath: 'docs/doc/01/review.md' }), /write denied/);
  assert.match(roleBoundaryViolation({ role: 'lean-verifier', toolName: 'write', filePath: 'docs/doc/01/test-report.md' }), /write denied/);
});
