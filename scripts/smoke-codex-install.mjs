#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const installHome = mkdtempSync(join(tmpdir(), 'cc-nexs-codex-home-'));
const realConfig = join(homedir(), '.codex', 'config.toml');
const realConfigBefore = digestIfPresent(realConfig);

function digestIfPresent(path) {
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function runInstall(preset) {
  execFileSync(process.execPath, [
    join(root, 'scripts', 'install-local-codex.mjs'),
    preset,
    '--home',
    installHome,
    '--skip-marketplace-register',
  ], {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function assertSelected(selectedKey) {
  const configPath = join(installHome, '.codex', 'config.toml');
  const config = readFileSync(configPath, 'utf8');
  for (const key of ['cc-nexs@cc-nexs', 'cc-nexs-minimal@cc-nexs']) {
    const section = config.match(new RegExp(`\\[plugins\\."${key}"\\]\\r?\\n([^\\[]*)`))?.[1] || '';
    const expected = key === selectedKey ? 'true' : 'false';
    if (!new RegExp(`^enabled\\s*=\\s*${expected}$`, 'm').test(section)) {
      throw new Error(`${configPath}: ${key} must have enabled = ${expected}`);
    }
  }
}

function assertCachedPlugin(pluginName) {
  const pluginRoot = join(
    installHome,
    '.codex',
    'plugins',
    'cache',
    'cc-nexs',
    pluginName,
    version,
  );
  const hooksPath = join(pluginRoot, 'hooks', 'hooks.json');
  if (!existsSync(join(pluginRoot, '.codex-plugin', 'plugin.json'))) {
    throw new Error(`${pluginRoot}: missing Codex plugin manifest`);
  }
  const hooks = readFileSync(hooksPath, 'utf8');
  if (/\$\{[^}]*:-/.test(hooks)) throw new Error(`${hooksPath}: POSIX-only fallback remains`);
  if (!hooks.includes('process.env.PLUGIN_ROOT')) throw new Error(`${hooksPath}: PLUGIN_ROOT launcher missing`);
}

try {
  const isolatedCodexHome = join(installHome, '.codex');
  mkdirSync(isolatedCodexHome, { recursive: true });
  writeFileSync(join(isolatedCodexHome, 'config.toml'), [
    '[unrelated]',
    'preserve = true',
    '',
    '[plugins."cc-nexs@cc-nexs"]',
    'enabled = false',
    '',
  ].join('\r\n'), 'utf8');

  runInstall('preset-standard');
  assertSelected('cc-nexs@cc-nexs');
  runInstall('preset-minimal');
  assertSelected('cc-nexs-minimal@cc-nexs');
  runInstall('preset-minimal');
  assertSelected('cc-nexs-minimal@cc-nexs');
  assertCachedPlugin('cc-nexs');
  assertCachedPlugin('cc-nexs-minimal');

  const isolatedConfig = readFileSync(join(isolatedCodexHome, 'config.toml'), 'utf8');
  if (!isolatedConfig.includes('[unrelated]\r\npreserve = true')) {
    throw new Error('Codex installer did not preserve unrelated CRLF TOML content');
  }
  for (const key of ['cc-nexs@cc-nexs', 'cc-nexs-minimal@cc-nexs']) {
    const matches = isolatedConfig.match(new RegExp(`\\[plugins\\."${key}"\\]`, 'g')) || [];
    if (matches.length !== 1) throw new Error(`Codex installer duplicated ${key} TOML section`);
  }

  const realConfigAfter = digestIfPresent(realConfig);
  if (realConfigAfter !== realConfigBefore) {
    throw new Error(`isolated Codex smoke modified real config: ${realConfig}`);
  }
  console.log('Codex install smoke passed: isolated home, preset switching, cache, and hooks verified.');
} finally {
  rmSync(installHome, { recursive: true, force: true });
}
