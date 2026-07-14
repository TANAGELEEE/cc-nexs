// Smoke tests for readme-sync.
// Run: npm run test:hooks

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncFeatureReadme, __test__, ANCHOR_START, ANCHOR_END } from './readme-sync.mjs';

function makeReqDir(currentState, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-nexs-readme-'));
  // Always seed progress.md with the desired state
  writeFileSync(join(dir, 'progress.md'), [
    '# X',
    '',
    '## 当前状态',
    '',
    '```yaml',
    `current_state: ${currentState}`,
    'updated_at: 2026-05-27T10:00:00Z',
    '```',
    '',
    '## 历史轨迹',
    '',
    '- 2026-05-27 INIT → ' + currentState,
    '',
    '## 待人工接入',
    '',
    '- (尚无)',
    '',
  ].join('\n'));
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(dir, filename), content);
  }
  return dir;
}

function readmeWithAnchor() {
  return [
    '# 01.test',
    '',
    '> 进入目录第一件事：读本文件。',
    '',
    ANCHOR_START,
    '(placeholder)',
    ANCHOR_END,
    '',
    '## 下一步动作（人工维护）',
    '',
    '- [ ] 测试用例',
    '',
  ].join('\n');
}

test('no_readme: returns reason without writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-nexs-noreadme-'));
  try {
    const r = syncFeatureReadme({ reqDir: dir });
    assert.equal(r.updated, false);
    assert.equal(r.reason, 'no_readme');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no_anchor: legacy README left untouched', () => {
  const dir = makeReqDir('INIT');
  const legacy = '# legacy README without anchors\n\n## 当前状态\nold stuff\n';
  writeFileSync(join(dir, 'README.md'), legacy);
  try {
    const r = syncFeatureReadme({ reqDir: dir });
    assert.equal(r.updated, false);
    assert.equal(r.reason, 'no_anchor');
    const after = readFileSync(join(dir, 'README.md'), 'utf-8');
    assert.equal(after, legacy, 'legacy README must be untouched');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('INIT state: requirements 🟢, all other artifacts ⚪', () => {
  const dir = makeReqDir('INIT', {
    'requirements.md': '需求初稿',
  });
  writeFileSync(join(dir, 'README.md'), readmeWithAnchor());
  try {
    const r = syncFeatureReadme({ reqDir: dir });
    assert.equal(r.updated, true);
    const after = readFileSync(join(dir, 'README.md'), 'utf-8');
    assert.match(after, /\| requirements\.md \| PM \| 🟢 \|/);
    assert.match(after, /\| spec\.md \| Planner \| ⚪ \|/);
    assert.match(after, /\| repo-context\.md \| Repo Scout \| ⚪ \|/);
    assert.match(after, /整体阶段.*INIT/);
    // Manual section MUST survive
    assert.match(after, /## 下一步动作（人工维护）/);
    assert.match(after, /- \[ \] 测试用例/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('RECON_DONE: repo-context 🟢, spec still ⚪', () => {
  const dir = makeReqDir('RECON_DONE', {
    'requirements.md': 'x',
    'repo-context.md': 'scout output',
  });
  writeFileSync(join(dir, 'README.md'), readmeWithAnchor());
  try {
    syncFeatureReadme({ reqDir: dir });
    const after = readFileSync(join(dir, 'README.md'), 'utf-8');
    assert.match(after, /\| repo-context\.md \| Repo Scout \| 🟢 \|/);
    assert.match(after, /\| spec\.md \| Planner \| ⚪ \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SPEC_APPROVED: spec 🟢, sa-review 🟢 when conclusion line present', () => {
  const dir = makeReqDir('SPEC_APPROVED', {
    'requirements.md': 'x',
    'repo-context.md': 'x',
    'spec.md': 'x',
    'sa-review.md': '...\n\n结论: PASS\n',
  });
  writeFileSync(join(dir, 'README.md'), readmeWithAnchor());
  try {
    syncFeatureReadme({ reqDir: dir });
    const after = readFileSync(join(dir, 'README.md'), 'utf-8');
    assert.match(after, /\| spec\.md \| Planner \| 🟢 \|/);
    assert.match(after, /\| sa-review\.md \| SA \| 🟢 \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SPEC_DRAFTED: spec 🟡 (mid state)', () => {
  const dir = makeReqDir('SPEC_DRAFTED', {
    'spec.md': 'draft',
  });
  writeFileSync(join(dir, 'README.md'), readmeWithAnchor());
  try {
    syncFeatureReadme({ reqDir: dir });
    const after = readFileSync(join(dir, 'README.md'), 'utf-8');
    assert.match(after, /\| spec\.md \| Planner \| 🟡 \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('idempotency: second call returns no_change', () => {
  const dir = makeReqDir('INIT', { 'requirements.md': 'x' });
  writeFileSync(join(dir, 'README.md'), readmeWithAnchor());
  try {
    const r1 = syncFeatureReadme({ reqDir: dir });
    assert.equal(r1.reason, 'synced');
    const r2 = syncFeatureReadme({ reqDir: dir });
    assert.equal(r2.updated, false);
    assert.equal(r2.reason, 'no_change');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acceptance snapshot: parses Sprint M1 conclusion', () => {
  const dir = makeReqDir('SPRINT_1_DONE', {
    'acceptance.md': [
      '## Sprint M1',
      '',
      '| AC-001 | ✅ |',
      '',
      '验收结果: 通过',
      '',
    ].join('\n'),
  });
  writeFileSync(join(dir, 'README.md'), readmeWithAnchor());
  try {
    syncFeatureReadme({ reqDir: dir });
    const after = readFileSync(join(dir, 'README.md'), 'utf-8');
    assert.match(after, /\| M1 \| 通过 \|/);
    assert.match(after, /\| acceptance\.md \| Evaluator \| 🟢 \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isAfterState: SPRINT_<N>_X normalized to >SPEC_APPROVED', () => {
  const { isAfterState } = __test__;
  assert.equal(isAfterState('SPRINT_1_DEV', 'SPEC_APPROVED'), true);
  assert.equal(isAfterState('SPRINT_2_QA_RUN', 'RECON_DONE'), true);
  assert.equal(isAfterState('INIT', 'SPEC_APPROVED'), false);
});
