import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { approveFeatureGate } from './approval-command.mjs';
import { runCcNexsCommand } from './cc-nexs-cli.mjs';
import { beginImplementationDelta, endImplementationDelta } from './implementation-delta.mjs';
import { createProgressV2, readProgressV2, writeProgressV2 } from './progress-v2.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function initRepository(path, file) {
  mkdirSync(path, { recursive: true });
  git(path, ['init']);
  git(path, ['config', 'user.name', 'Delta Test']);
  git(path, ['config', 'user.email', 'delta@example.com']);
  writeFileSync(join(path, file), 'base\n');
  git(path, ['add', file]);
  git(path, ['commit', '-m', 'base']);
  git(path, ['branch', '-M', 'feature/40-delta']);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-implementation-delta-test-'));
  roots.push(root);
  const docsRepo = join(root, 'docs');
  const api = join(root, 'api');
  const web = join(root, 'web');
  const mobile = join(root, 'mobile');
  initRepository(docsRepo, 'README.md');
  initRepository(api, 'pom.xml');
  initRepository(web, 'package.json');
  initRepository(mobile, 'package.json');
  mkdirSync(join(api, 'src'), { recursive: true });
  mkdirSync(join(web, 'src'), { recursive: true });
  writeFileSync(join(api, 'src', 'existing.js'), 'base\n');
  writeFileSync(join(web, 'src', 'existing.js'), 'base\n');
  git(api, ['add', 'src/existing.js']);
  git(api, ['commit', '-m', 'api source']);
  git(web, ['add', 'src/existing.js']);
  git(web, ['commit', '-m', 'web source']);

  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), [
    'version: 1',
    'docs_repository: docs',
    'repositories:',
    '  - id: docs',
    '    path: docs',
    '    docs: true',
    '    base_branch: main',
    '  - id: api',
    '    path: api',
    '    base_branch: main',
    '  - id: web',
    '    path: web',
    '    base_branch: main',
    '  - id: mobile',
    '    path: mobile',
    '    base_branch: main',
    '',
  ].join('\n'));
  const featureDir = join(docsRepo, 'doc', '40.delta');
  mkdirSync(featureDir, { recursive: true });
  const progressFile = join(featureDir, 'progress.json');
  const progress = createProgressV2({
    featureId: '40', featureSlug: 'delta', preset: 'preset-standard', mode: 'full',
    repositories: ['docs', 'api', 'web', 'mobile'],
  });
  progress.state = 'SPEC_PENDING_HUMAN';
  for (const [id, path] of [['docs', docsRepo], ['api', api], ['web', web], ['mobile', mobile]]) {
    progress.repositories[id] = {
      branch: 'feature/40-delta',
      worktree: id,
      base_branch: 'main',
      base_commit: git(path, ['rev-parse', 'HEAD']),
      candidate: null,
    };
  }
  writeProgressV2(progressFile, progress);
  writeFileSync(join(featureDir, 'progress.md'), [
    '## 当前状态', '', '```yaml', 'current_state: SPEC_PENDING_HUMAN', 'updated_at: null', '```', '',
    '## 人工 gate', '', '### G1: Spec 审批', '', '```yaml', 'human_approved_at: null',
    'human_approver: null', '```', '', '## 历史轨迹', '', '- (尚无)', '',
  ].join('\n'));
  writeFileSync(join(featureDir, 'spec.md'), [
    '# Spec',
    '| AC-ID | Given | When | Then | 关联 Sprint |',
    '|---|---|---|---|---|',
    '| AC-001 | a | b | c | M1 |',
    '| AC-002 | a | b | c | M1 |',
    '<!-- IMPLEMENTATION-OWNERSHIP:START -->',
    '| Assignment | Sprint | Surface | AC | Repository | Allowed paths | Depends on | Validation | Wave |',
    '|---|---|---|---|---|---|---|---|---|',
    '| IMP-api | M1 | backend | AC-001 | api | src/api/** | - | unit | 1 |',
    '| IMP-web | M1 | web | AC-002 | web | src/web/** | - | unit | 1 |',
    '| IMP-api-next | M1 | backend | AC-001 | api | src/next/** | IMP-api | unit | 2 |',
    '<!-- IMPLEMENTATION-OWNERSHIP:END -->',
    '## 变更记录',
    '| 日期 | 变更内容 | 触发原因 | 影响的 AC-ID / Sprint | 操作人 |',
    '|---|---|---|---|---|',
    '| today | initial | initial | all | planner |',
  ].join('\n'));
  approveFeatureGate({
    cwd: root, featureId: '40', gate: 'g1', approver: 'Owner', progressPath: progressFile,
  });
  return { root, api, web, mobile, featureDir, progressFile };
}

test('approved same-wave changes pass without mutating the real index', () => {
  const current = fixture();
  const indexBefore = git(current.api, ['diff', '--cached', '--name-only']);
  const begin = beginImplementationDelta({
    cwd: current.root, featureId: '40', progressPath: current.progressFile,
    assignmentIds: ['IMP-api', 'IMP-web'],
  });
  mkdirSync(join(current.api, 'src', 'api'), { recursive: true });
  mkdirSync(join(current.web, 'src', 'web'), { recursive: true });
  writeFileSync(join(current.api, 'src', 'api', 'upload.js'), 'api\n');
  writeFileSync(join(current.web, 'src', 'web', 'upload.js'), 'web\n');
  const result = endImplementationDelta({
    cwd: current.root, featureId: '40', progressPath: current.progressFile, token: begin.token,
  });
  assert.deepEqual(result.changed.api, ['src/api/upload.js']);
  assert.deepEqual(result.changed.web, ['src/web/upload.js']);
  assert.equal(git(current.api, ['diff', '--cached', '--name-only']), indexBefore);
});

test('CLI begin/end preserves the same deterministic batch contract', () => {
  const current = fixture();
  const begin = runCcNexsCommand([
    'implementation-delta', 'begin', '40', '--assignment', 'IMP-api', '--progress', current.progressFile,
  ], { cwd: current.root });
  mkdirSync(join(current.api, 'src', 'api'), { recursive: true });
  writeFileSync(join(current.api, 'src', 'api', 'cli.js'), 'cli\n');
  const end = runCcNexsCommand([
    'implementation-delta', 'end', '40', '--token', begin.token, '--progress', current.progressFile,
  ], { cwd: current.root });
  assert.deepEqual(end.changed.api, ['src/api/cli.js']);
});

test('untracked and tracked paths outside an active assignment fail closed', () => {
  const current = fixture();
  const begin = beginImplementationDelta({
    cwd: current.root, featureId: '40', progressPath: current.progressFile, assignmentIds: ['IMP-api'],
  });
  writeFileSync(join(current.api, 'pom.xml'), 'changed\n');
  writeFileSync(join(current.api, 'outside.txt'), 'untracked\n');
  assert.throws(
    () => endImplementationDelta({
      cwd: current.root, featureId: '40', progressPath: current.progressFile, token: begin.token,
    }),
    /api:outside\.txt.*api:pom\.xml|api:pom\.xml.*api:outside\.txt/,
  );
});

test('a worker cannot stage even an otherwise allowed path', () => {
  const current = fixture();
  const begin = beginImplementationDelta({
    cwd: current.root, featureId: '40', progressPath: current.progressFile, assignmentIds: ['IMP-api'],
  });
  mkdirSync(join(current.api, 'src', 'api'), { recursive: true });
  writeFileSync(join(current.api, 'src', 'api', 'staged.js'), 'staged\n');
  git(current.api, ['add', 'src/api/staged.js']);
  assert.throws(
    () => endImplementationDelta({
      cwd: current.root, featureId: '40', progressPath: current.progressFile, token: begin.token,
    }),
    /mutated the real Git index for api/,
  );
});

test('a worker cannot change an inactive, future-wave, or ownership-removed repository', () => {
  const current = fixture();
  const begin = beginImplementationDelta({
    cwd: current.root, featureId: '40', progressPath: current.progressFile, assignmentIds: ['IMP-api'],
  });
  mkdirSync(join(current.web, 'src', 'web'), { recursive: true });
  writeFileSync(join(current.web, 'src', 'web', 'cross.js'), 'cross repo\n');
  writeFileSync(join(current.mobile, 'package.json'), 'ownership removed but still assigned\n');
  assert.throws(
    () => endImplementationDelta({
      cwd: current.root, featureId: '40', progressPath: current.progressFile, token: begin.token,
    }),
    /mobile:package\.json.*web:src\/web\/cross\.js|web:src\/web\/cross\.js.*mobile:package\.json/,
  );
});

test('Full QA receives only its explicit docs allowance and Fast-style zero-delta remains the default', () => {
  const allowed = fixture();
  const qaBegin = beginImplementationDelta({
    cwd: allowed.root,
    featureId: '40',
    progressPath: allowed.progressFile,
    assignmentIds: ['IMP-api'],
    allowedDocPaths: ['test-cases.md'],
  });
  writeFileSync(join(allowed.featureDir, 'test-cases.md'), '# M1 cases\n');
  assert.doesNotThrow(() => endImplementationDelta({
    cwd: allowed.root, featureId: '40', progressPath: allowed.progressFile, token: qaBegin.token,
  }));

  const denied = fixture();
  const strictBegin = beginImplementationDelta({
    cwd: denied.root,
    featureId: '40',
    progressPath: denied.progressFile,
    assignmentIds: ['IMP-api'],
  });
  writeFileSync(join(denied.featureDir, 'notes.md'), 'changed by implementation worker\n');
  assert.throws(
    () => endImplementationDelta({
      cwd: denied.root, featureId: '40', progressPath: denied.progressFile, token: strictBegin.token,
    }),
    /docs:doc\/40\.delta\/notes\.md/,
  );
});

test('a later wave cannot rewrite an already-dirty path outside its own allowance', () => {
  const current = fixture();
  mkdirSync(join(current.api, 'src', 'api'), { recursive: true });
  const earlier = join(current.api, 'src', 'api', 'earlier.js');
  writeFileSync(earlier, 'wave one\n');
  const begin = beginImplementationDelta({
    cwd: current.root, featureId: '40', progressPath: current.progressFile, assignmentIds: ['IMP-api-next'],
  });
  writeFileSync(earlier, 'wave two rewrote wave one\n');
  assert.throws(
    () => endImplementationDelta({
      cwd: current.root, featureId: '40', progressPath: current.progressFile, token: begin.token,
    }),
    /api:src\/api\/earlier\.js/,
  );
  assert.equal(readProgressV2(current.progressFile).state, 'SPEC_APPROVED');
});
