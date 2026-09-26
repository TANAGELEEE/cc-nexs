import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createProgressV2, writeProgressV2 } from './progress-v2.mjs';

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

test('Hotfix evidence roles and Claude hook write only the current assigned BUG document', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-role-bug-'));
  try {
    const stateDir = join(root, '.cc-nexs', 'hotfixes', 'fix-1');
    const docs = join(root, 'docs');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(join(docs, 'notes'), { recursive: true });
    writeFileSync(join(root, '.cc-nexs', 'workspace.json'), '{}');
    writeFileSync(join(docs, 'notes', 'custom-bug.md'), '# Current BUG\n');
    writeFileSync(join(docs, 'notes', 'other.md'), '# Other task\n');
    writeFileSync(join(docs, 'hotfix.md'), '# Legacy name in another task\n');
    const progressPath = join(stateDir, 'progress.json');
    const progress = createProgressV2({ featureId: 'fix-1', featureSlug: 'fix', preset: 'preset-standard', mode: 'hotfix' });
    progress.repositories.docs = { worktree: 'docs', branch: 'hotfix/fix-1', candidate: null };
    progress.hotfix_document = { repository: 'docs', path: 'notes/custom-bug.md' };
    writeProgressV2(progressPath, progress);
    for (const role of ['hotfix-reviewer', 'hotfix-verifier', 'cc-nexs.hotfix-verifier-computer-use']) {
      const args = { role, toolName: 'write', progressPath, cwd: docs };
      assert.equal(roleBoundaryViolation({ ...args, filePath: 'notes/custom-bug.md' }), null);
      assert.match(roleBoundaryViolation({ ...args, filePath: 'notes/other.md' }), /write denied/);
      assert.match(roleBoundaryViolation({ ...args, filePath: 'hotfix.md' }), /write denied/);
      assert.match(roleBoundaryViolation({ ...args, progressPath: null, filePath: 'notes/custom-bug.md' }), /write denied/);
    }
    const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'role-boundary-guard.mjs');
    for (const [filePath, status] of [['notes/custom-bug.md', 0], ['notes/other.md', 2]]) {
      const result = spawnSync(process.execPath, [hook], {
        cwd: docs, input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath } }), encoding: 'utf8',
        env: { ...process.env, CC_NEXS_ROLE: 'hotfix-reviewer', CC_NEXS_PROGRESS_FILE: progressPath, CC_NEXS_REQ_DIR: '' },
      });
      assert.equal(result.status, status, result.stderr);
    }
    const fallback = spawnSync(process.execPath, [hook], {
      cwd: docs, input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'notes/custom-bug.md' } }), encoding: 'utf8',
      env: { ...process.env, CC_NEXS_ROLE: 'hotfix-verifier', CC_NEXS_PROGRESS_FILE: '', CC_NEXS_REQ_DIR: stateDir },
    });
    assert.equal(fallback.status, 0, fallback.stderr);
    const outside = join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'custom-bug.md'), '# Outside\n');
    rmSync(join(docs, 'notes'), { recursive: true });
    symlinkSync(outside, join(docs, 'notes'));
    assert.match(roleBoundaryViolation({ role: 'hotfix-reviewer', toolName: 'write', progressPath, cwd: docs, filePath: 'notes/custom-bug.md' }), /cannot resolve assigned document/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
