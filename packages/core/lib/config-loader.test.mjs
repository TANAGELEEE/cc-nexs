import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadConfig, loadWorkspaceConfig } from './config-loader.mjs';

test('private overlay overrides public preset without mutating unrelated defaults', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-config-'));
  const preset = join(root, 'preset');
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  mkdirSync(preset);
  writeFileSync(join(preset, 'preset.yml'), [
    'language: en-US',
    'stack:',
    '  type: generic',
    '  build_cmd: ""',
    '  src_paths:',
    '    - "src/**"',
    'workflow:',
    '  sprint_delivery: final_only',
    '  test_release:',
    '    policy: auto_if_ready',
    '  thresholds:',
    '    review_revision: 3',
  ].join('\n'));
  writeFileSync(join(root, '.cc-nexs/overlay.yml'), [
    'stack:',
    '  type: private-stack',
    '  build_cmd: "tool build"',
    '  src_paths:',
    '    - "service/**"',
    'release:',
    '  test:',
    '    app_url: "https://test.example.com"',
  ].join('\n'));

  try {
    const config = loadConfig({ projectRoot: root, presetRoot: preset });
    assert.equal(config.preset.stack.type, 'private-stack');
    assert.equal(config.mergedStack.build_cmd, 'tool build');
    assert.deepEqual(config.mergedStack.src_paths, ['service/**']);
    assert.equal(config.mergedThresholds.review_revision, 3);
    assert.equal(config.mergedWorkflow.sprint_delivery, 'final_only');
    assert.equal(config.mergedWorkflow.test_release.policy, 'auto_if_ready');
    assert.equal(config.mergedRelease.test.app_url, 'https://test.example.com');
    assert.equal(config.overlayPath, join(root, '.cc-nexs/overlay.yml'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace config resolves repositories and rejects path escapes', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-workspace-'));
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs/workspace.yml'), [
    'version: 1',
    'docs_repository: docs',
    'repositories:',
    '  - id: docs',
    '    path: docs',
    '    docs: true',
    '  - id: api',
    '    path: ../private-api',
  ].join('\n'));

  try {
    assert.throws(() => loadWorkspaceConfig({ projectRoot: root }), /escapes workspace root/);
    writeFileSync(join(root, '.cc-nexs/workspace.yml'), [
      'version: 1',
      'docs_repository: docs',
      'repositories:',
      '  - id: docs',
      '    path: docs',
      '    docs: true',
      '  - id: api',
      '    path: api',
      '    base_branch: develop',
      '    test_branch: test',
      '    release_order: 20',
    ].join('\n'));
    const workspace = loadWorkspaceConfig({ projectRoot: root });
    assert.equal(workspace.repositories[0].base_branch, 'main');
    assert.equal(workspace.repositories[1].base_branch, 'develop');
    assert.equal(workspace.repositories[1].test_branch, 'test');
    assert.equal(workspace.repositories[1].release_order, 20);
    assert.equal(workspace.repositories[1].absolute_path, join(root, 'api'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
