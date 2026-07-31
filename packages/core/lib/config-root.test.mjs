import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { configuredPluginRoot, findProjectConfigRoot } from './config-root.mjs';

test('build helpers find workspace config above an assigned feature worktree', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-config-root-'));
  try {
    const worktree = join(root, '.worktrees', '01-feature', 'api');
    mkdirSync(join(root, '.cc-nexs'), { recursive: true });
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), 'version: 1\n');
    assert.equal(findProjectConfigRoot(worktree), root);
    assert.equal(configuredPluginRoot({ CODEX_PLUGIN_ROOT: '/plugin' }), '/plugin');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
