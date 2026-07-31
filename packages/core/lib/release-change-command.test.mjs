import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createProgressV2, readProgressV2, writeProgressV2 } from './progress-v2.mjs';
import { requestReleaseChanges } from './release-change-command.mjs';

function fixture({ includePlan = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-release-change-'));
  const docs = join(root, 'all-docs', 'doc', '42.gateway-change');
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), 'version: 1\n');
  const progress = createProgressV2({ featureId: '42', featureSlug: 'gateway-change', preset: 'preset-standard', mode: 'lean' });
  progress.state = 'RELEASE_PENDING_HUMAN';
  writeProgressV2(join(docs, 'progress.json'), progress);
  writeFileSync(join(docs, 'requirements.md'), '# Requirements\n\n## 需求变更\n\n| 日期 | 变更 | 原因 | 影响 AC |\n|---|---|---|---|---|\n');
  if (includePlan) {
    writeFileSync(join(docs, 'plan.md'), '# Plan\n\n## Gateway B 变更请求\n\n| ID | 类型 | 提出人 | 影响 AC | 允许修改路径 | 意见 | 状态 |\n|---|---|---|---|---|---|---|\n');
  }
  return { root, docs, progressFile: join(docs, 'progress.json') };
}

function hotfixFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-hotfix-release-change-'));
  const docs = join(root, 'all-docs', 'doc', '43.hotfix-gateway-change');
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), 'version: 1\n');
  const progress = createProgressV2({ featureId: '43', featureSlug: 'hotfix-gateway-change', preset: 'preset-standard', mode: 'hotfix' });
  progress.state = 'HOTFIX_RELEASE_PENDING_HUMAN';
  writeProgressV2(join(docs, 'progress.json'), progress);
  writeFileSync(join(docs, 'hotfix.md'), '# Hotfix\n\n## Gateway B 变更请求\n\n| ID | 类型 | 提出人 | 允许修改路径 | 意见 | 状态 |\n|---|---|---|---|---|---|\n');
  return { root, docs, progressFile: join(docs, 'progress.json') };
}

test('Gateway B controller updates the canonical plan and renders HTML', () => {
  const current = fixture();
  try {
    const result = requestReleaseChanges({
      cwd: current.root,
      featureId: '42',
      kind: 'implementation',
      feedback: '调整错误提示 | 保持 API 不变',
      affectedAcs: ['AC-001'],
      paths: ['web/src/error.ts'],
      actor: 'product-owner',
    });
    const plan = readFileSync(join(current.docs, 'plan.md'), 'utf8');
    assert.equal(result.state, 'GATEWAY_B_CHANGE_REQUESTED');
    assert.match(plan, /gateway-b-1/);
    assert.match(plan, /调整错误提示 \\| 保持 API 不变/);
    assert.match(plan, /\| open \|/);
    assert.equal(existsSync(result.planHtml), true);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test('Gateway B controller validates canonical documents before mutating progress', () => {
  const current = fixture({ includePlan: false });
  try {
    assert.throws(() => requestReleaseChanges({
      cwd: current.root,
      featureId: '42',
      kind: 'implementation',
      feedback: 'fix it',
    }), /Gateway B document is missing/);
    const progress = readProgressV2(current.progressFile);
    assert.equal(progress.state, 'RELEASE_PENDING_HUMAN');
    assert.equal(progress.revision, 0);
    assert.deepEqual(progress.change_requests.items, []);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test('Hotfix Gateway B distinguishes evidence, implementation, and forbidden scope feedback', () => {
  const current = hotfixFixture();
  try {
    const evidence = requestReleaseChanges({
      cwd: current.root,
      featureId: '43',
      kind: 'evidence',
      feedback: '补充回滚截图',
      actor: 'release-owner',
    });
    assert.equal(evidence.state, 'HOTFIX_RELEASE_PENDING_HUMAN');
    assert.equal(evidence.planHtml, null);
    let saved = readProgressV2(current.progressFile);
    assert.equal(saved.change_requests.items[0].status, 'recorded');

    const implementation = requestReleaseChanges({
      cwd: current.root,
      featureId: '43',
      kind: 'implementation',
      feedback: '修正空值保护',
      paths: ['api/src/payment.ts'],
      actor: 'release-owner',
    });
    assert.equal(implementation.state, 'HOTFIX_CHANGE_REQUESTED');
    saved = readProgressV2(current.progressFile);
    assert.equal(saved.change_requests.current, 'gateway-b-2');
    assert.equal(saved.local_verification.status, 'idle');
    const hotfix = readFileSync(join(current.docs, 'hotfix.md'), 'utf8');
    assert.match(hotfix, /gateway-b-1/);
    assert.match(hotfix, /gateway-b-2/);

    saved.state = 'HOTFIX_RELEASE_PENDING_HUMAN';
    writeProgressV2(current.progressFile, saved);
    assert.throws(() => requestReleaseChanges({
      cwd: current.root,
      featureId: '43',
      kind: 'scope',
      feedback: '新增公开接口',
      actor: 'release-owner',
    }), /lean\/full/);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});
