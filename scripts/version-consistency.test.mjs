import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const rootVersion = readJson(join(root, 'package.json')).version;

test('package, plugin, dist, and Claude marketplace versions match the root version', () => {
  const versionedFiles = [
    'packages/core/package.json',
    'packages/preset-minimal/package.json',
    'packages/preset-standard/package.json',
    'packages/preset-minimal/.claude-plugin/plugin.json',
    'packages/preset-minimal/.codex-plugin/plugin.json',
    'packages/preset-standard/.claude-plugin/plugin.json',
    'packages/preset-standard/.codex-plugin/plugin.json',
    'dist/preset-minimal/.claude-plugin/plugin.json',
    'dist/preset-minimal/.codex-plugin/plugin.json',
    'dist/preset-standard/.claude-plugin/plugin.json',
    'dist/preset-standard/.codex-plugin/plugin.json',
  ];
  for (const relativePath of versionedFiles) {
    assert.equal(readJson(join(root, relativePath)).version, rootVersion, relativePath);
  }
  for (const relativePath of [
    'packages/preset-minimal/preset.yml',
    'packages/preset-standard/preset.yml',
    'dist/preset-minimal/preset.yml',
    'dist/preset-standard/preset.yml',
  ]) {
    const version = readFileSync(join(root, relativePath), 'utf8').match(/^version:\s*(\S+)/m)?.[1];
    assert.equal(version, rootVersion, relativePath);
  }

  const marketplace = readJson(join(root, '.claude-plugin', 'marketplace.json'));
  assert.equal(marketplace.metadata?.version, rootVersion, '.claude-plugin/marketplace.json metadata');
  for (const plugin of marketplace.plugins || []) {
    assert.equal(plugin.version, rootVersion, `.claude-plugin/marketplace.json ${plugin.name}`);
  }
});
