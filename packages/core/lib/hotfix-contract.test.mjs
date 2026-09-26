import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertHotfixCandidatePaths, assertHotfixScopeCurrent, extractHotfixScope, hotfixScopeBinding } from './hotfix-contract.mjs';

const valid = `# Hotfix\n\n<!-- HOTFIX-SCOPE START -->\n- severity: P2\n- related_feature: 42\n- intended_paths: src/a.js\n- acceptance_contract_change: no\n- api_contract_change: no\n- database_schema_change: no\n- permission_model_change: no\n- broad_refactor: no\n- non_behavioral_change: no\n<!-- HOTFIX-SCOPE END -->\n`;

test('hotfix scope binds severity/association and rejects contract expansion', () => {
  const scope = extractHotfixScope(valid);
  assert.equal(scope.severity, 'P2');
  assert.equal(scope.relatedFeature, '42');
  assert.throws(() => extractHotfixScope(valid.replace('api_contract_change: no', 'api_contract_change: yes')), /lean\/full/);
});

test('hotfix scope mutation after binding fails closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-hotfix-contract-'));
  try {
    const file = join(root, 'hotfix.md');
    writeFileSync(file, valid);
    const binding = hotfixScopeBinding(root);
    const progress = { mode: 'hotfix', hotfix: { severity: 'P2', related_feature: '42', scope_binding: binding } };
    assert.equal(assertHotfixScopeCurrent(progress, root).hotfix_scope_sha256, binding.hotfix_scope_sha256);
    writeFileSync(file, readFileSync(file, 'utf8').replace('src/a.js', 'src/b.js'));
    assert.throws(() => assertHotfixScopeCurrent(progress, root), /scope changed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('P3 declaration requires a non-behavioral scope', () => {
  assert.throws(() => extractHotfixScope(valid.replace('severity: P2', 'severity: P3')), /non_behavioral_change/);
  const p3 = extractHotfixScope(valid.replace('severity: P2', 'severity: P3').replace('non_behavioral_change: no', 'non_behavioral_change: yes'));
  assert.equal(p3.nonBehavioral, true);
});

test('hotfix scope requires exactly one non-empty ordered marker pair', () => {
  assert.throws(() => extractHotfixScope(`${valid}\n${valid}`), /exactly one/);
  assert.throws(() => extractHotfixScope('<!-- HOTFIX-SCOPE START -->\n\n<!-- HOTFIX-SCOPE END -->'), /scope is empty/);
  assert.throws(() => extractHotfixScope('<!-- HOTFIX-SCOPE END -->\n- severity: P2\n<!-- HOTFIX-SCOPE START -->'), /ordered/);
});

test('non-behavioral declaration is rejected for P0/P1/P2', () => {
  assert.throws(() => extractHotfixScope(valid.replace('non_behavioral_change: no', 'non_behavioral_change: yes')), /reserved for P3/);
});


test('Hotfix path checks exclude merged upstream changes but retain the complete repair delta', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-hotfix-upstream-'));
  const repo = join(root, 'api');
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    mkdirSync(join(repo, 'src'), { recursive: true });
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test User');
    git('config', 'user.email', 'test@example.com');
    writeFileSync(join(repo, 'src', 'a.js'), 'export const fixed = false;\n');
    git('add', '.'); git('commit', '-m', 'baseline');
    const initialBase = git('rev-parse', 'HEAD');
    git('switch', '-c', 'hotfix/repair');
    writeFileSync(join(repo, 'src', 'a.js'), 'export const fixed = true;\n');
    git('add', '.'); git('commit', '-m', 'repair');
    writeFileSync(join(root, 'hotfix.md'), valid);
    const context = {
      progress: { mode: 'hotfix' }, progressFile: join(root, 'progress.json'),
      repositories: [{ id: 'api', repository: { absolute_path: repo }, assignment: { base_commit: initialBase, base_branch: 'main' }, sourceCommit: git('rev-parse', 'HEAD') }],
    };
    assert.doesNotThrow(() => assertHotfixCandidatePaths(context));
    git('switch', 'main');
    writeFileSync(join(repo, 'src', 'b.js'), 'export const upstream = true;\n');
    git('add', '.'); git('commit', '-m', 'upstream change');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('switch', 'hotfix/repair');
    git('merge', '--no-edit', 'main');
    context.repositories[0].sourceCommit = git('rev-parse', 'HEAD');
    assert.doesNotThrow(() => assertHotfixCandidatePaths(context));
    git('switch', 'main');
    writeFileSync(join(repo, 'src', 'b.js'), 'export const upstream = 2;\n');
    git('add', '.'); git('commit', '-m', 'unmerged upstream change');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('switch', 'hotfix/repair');
    assert.doesNotThrow(() => assertHotfixCandidatePaths(context));
    writeFileSync(join(repo, 'src', 'c.js'), 'export const outside = true;\n');
    git('add', '.'); git('commit', '-m', 'outside repair scope');
    context.repositories[0].sourceCommit = git('rev-parse', 'HEAD');
    assert.throws(() => assertHotfixCandidatePaths(context), /outside intended_paths: api\/src\/c.js/);
    assert.equal(context.repositories[0].assignment.base_commit, initialBase);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
