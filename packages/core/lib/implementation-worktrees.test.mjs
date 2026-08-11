import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, test } from 'node:test';

import { loadWorkspaceConfig } from './config-loader.mjs';
import { createWorkspaceWorktrees } from './git-custodian.mjs';
import { syncImplementationWorktrees } from './implementation-worktrees.mjs';
import { createProgressV2, readProgressV2, writeProgressV2 } from './progress-v2.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function createRepository(root, id) {
  const origin = join(root, `${id}-origin.git`);
  const repo = join(root, id);
  mkdirSync(origin);
  git(origin, ['init', '--bare']);
  git(root, ['clone', origin, repo]);
  git(repo, ['config', 'user.name', 'Implementation Sync Test']);
  git(repo, ['config', 'user.email', 'implementation-sync@example.com']);
  git(repo, ['checkout', '-b', 'main']);
  writeFileSync(join(repo, 'README.md'), `${id}\n`);
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  git(repo, ['push', '-u', 'origin', 'main']);
  return repo;
}

function ownershipSpec(repositories) {
  return [
    '# Spec',
    '<!-- IMPLEMENTATION-OWNERSHIP:START -->',
    '| Assignment | Sprint | Surface | AC | Repository | Allowed paths | Depends on | Validation | Wave |',
    '|---|---|---|---|---|---|---|---|---|',
    ...repositories.map((repository, index) => (
      `| IMP-${repository} | M1 | ${repository} | AC-${String(index + 1).padStart(3, '0')} | ${repository} | src/** | - | unit | 1 |`
    )),
    '<!-- IMPLEMENTATION-OWNERSHIP:END -->',
    '| AC-ID | Given | When | Then | 所属 Sprint |',
    '|---|---|---|---|---|',
    ...repositories.map((repository, index) => (
      `| AC-${String(index + 1).padStart(3, '0')} | ${repository} | change | works | M1 |`
    )),
    '## 变更记录',
    '| 日期 | 变更内容 | 触发原因 | 影响的 AC-ID / Sprint | 操作人 |',
    '|---|---|---|---|---|',
  ].join('\n');
}

function createFixture({ id = '41', repositories = ['api'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-implementation-sync-'));
  roots.push(root);
  createRepository(root, 'docs');
  for (const repository of repositories) createRepository(root, repository);
  mkdirSync(join(root, '.cc-nexs', 'reservations'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'reservations', `${id}.json`), JSON.stringify({
    feature_id: id, feature_slug: 'parallel', reserved_at: new Date().toISOString(),
  }));
  writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), [
    'version: 1',
    'worktree_root: .worktrees',
    'docs_repository: docs',
    'repositories:',
    '  - id: docs',
    '    path: docs',
    '    docs: true',
    '    base_branch: main',
    ...repositories.flatMap((repository) => [
      `  - id: ${repository}`,
      `    path: ${repository}`,
      '    base_branch: main',
    ]),
    '',
  ].join('\n'));
  const featureDir = join(root, 'feature-doc', `${id}.parallel`);
  mkdirSync(featureDir, { recursive: true });
  const progressFile = join(featureDir, 'progress.json');
  const progress = createProgressV2({
    featureId: id, featureSlug: 'parallel', preset: 'preset-standard', mode: 'fast', repositories: [],
  });
  progress.state = 'SPEC_DRAFTED';
  writeProgressV2(progressFile, progress);
  writeFileSync(join(featureDir, 'progress.md'), `current_state: SPEC_DRAFTED\nupdated_at: null\n`);
  writeFileSync(join(featureDir, 'spec.md'), ownershipSpec(repositories));
  return { root, featureDir, progressFile };
}

test('pre-G1 sync creates only declared code worktrees and repeated execution is a no-op', () => {
  const fixture = createFixture();
  const first = syncImplementationWorktrees({
    cwd: fixture.root, featureId: '41', progressPath: fixture.progressFile,
  });
  assert.deepEqual(first.created, ['api']);
  assert.deepEqual(first.recovered, []);
  const progress = readProgressV2(fixture.progressFile);
  assert.equal(progress.repositories.api.branch, 'feature/41-parallel');
  assert.equal(progress.repositories.api.worktree, relative(fixture.root, join(fixture.root, '.worktrees', '41-parallel', 'api')));
  assert.equal(existsSync(join(fixture.root, '.worktrees', '41-parallel', 'api')), true);
  const revision = progress.revision;

  const second = syncImplementationWorktrees({
    cwd: fixture.root, featureId: '41', progressPath: fixture.progressFile,
  });
  assert.equal(second.changed, false);
  assert.deepEqual(second.created, []);
  assert.equal(readProgressV2(fixture.progressFile).revision, revision);
});

test('pre-G1 sync recovers an exact clean worktree created before progress persistence', () => {
  const fixture = createFixture({ id: '42' });
  const workspace = loadWorkspaceConfig({ projectRoot: fixture.root });
  createWorkspaceWorktrees(workspace, {
    featureId: '42', featureSlug: 'parallel', repositoryIds: ['api'],
  });

  const result = syncImplementationWorktrees({
    cwd: fixture.root, featureId: '42', progressPath: fixture.progressFile,
  });
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.recovered, ['api']);
  assert.equal(readProgressV2(fixture.progressFile).repositories.api.branch, 'feature/42-parallel');
});

test('partial sync failure rolls back newly-created siblings and preserves progress', () => {
  const fixture = createFixture({ id: '43', repositories: ['api', 'web'] });
  git(join(fixture.root, 'web'), ['branch', 'feature/43-parallel', 'main']);

  assert.throws(() => syncImplementationWorktrees({
    cwd: fixture.root, featureId: '43', progressPath: fixture.progressFile,
  }), /incomplete existing worktree\/branch pair for web/);
  assert.equal(existsSync(join(fixture.root, '.worktrees', '43-parallel', 'api')), false);
  assert.throws(() => git(join(fixture.root, 'api'), ['show-ref', '--verify', 'refs/heads/feature/43-parallel']));
  assert.deepEqual(readProgressV2(fixture.progressFile).repositories, {});
});

test('sync refuses role sessions and any state at or beyond G1', () => {
  const fixture = createFixture({ id: '44' });
  const previousRole = process.env.CC_NEXS_ROLE;
  process.env.CC_NEXS_ROLE = 'fullstack';
  try {
    assert.throws(() => syncImplementationWorktrees({
      cwd: fixture.root, featureId: '44', progressPath: fixture.progressFile,
    }), /parent-only/);
  } finally {
    if (previousRole === undefined) delete process.env.CC_NEXS_ROLE;
    else process.env.CC_NEXS_ROLE = previousRole;
  }

  const progress = readProgressV2(fixture.progressFile);
  progress.state = 'SPEC_APPROVED';
  progress.gates.g1.approved = true;
  writeProgressV2(fixture.progressFile, progress);
  assert.throws(() => syncImplementationWorktrees({
    cwd: fixture.root, featureId: '44', progressPath: fixture.progressFile,
  }), /only before G1/);
});
