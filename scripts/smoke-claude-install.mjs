#!/usr/bin/env node
// Smoke-test Claude Code local install with an isolated HOME.
// This proves Codex additions do not require changing the current Claude install flow.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;
const tmpHome = mkdtempSync(join(tmpdir(), 'cc-nexs-claude-home-'));
const errors = [];

function fail(message) {
  errors.push(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    fail(`${path}: invalid JSON (${error.message})`);
    return {};
  }
}

function runInstall(preset) {
  execFileSync('node', [join(ROOT, 'scripts', 'install-local.mjs'), preset], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: tmpHome,
    },
    stdio: 'pipe',
    encoding: 'utf-8',
  });
}

function validateInstalledPlugin(pluginName) {
  const key = `${pluginName}@cc-nexs`;
  const cachePath = join(tmpHome, '.claude', 'plugins', 'cache', 'cc-nexs', pluginName, VERSION);
  const installed = readJson(join(tmpHome, '.claude', 'plugins', 'installed_plugins.json'));
  const record = installed.plugins?.[key]?.[0];
  if (!record) {
    fail(`installed_plugins.json: missing ${key}`);
  } else if (record.installPath !== cachePath) {
    fail(`installed_plugins.json: ${key} installPath must be ${cachePath}`);
  }
  if (!existsSync(join(cachePath, '.claude-plugin', 'plugin.json'))) {
    fail(`${cachePath}: missing .claude-plugin/plugin.json`);
  }
  if (existsSync(join(cachePath, 'skills', 'cc-nexs-run', 'SKILL.md'))) {
    fail(`${cachePath}: Codex mirror skill leaked into Claude Code skills/`);
  }
}

function validateMarketplaceAndSettings() {
  const link = join(tmpHome, '.claude', 'plugins', 'marketplaces', 'cc-nexs');
  if (!lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) {
    fail(`${link}: expected symlink`);
  } else if (readlinkSync(link) !== ROOT) {
    fail(`${link}: expected symlink target ${ROOT}`);
  }

  const known = readJson(join(tmpHome, '.claude', 'plugins', 'known_marketplaces.json'));
  const knownEntry = known['cc-nexs'];
  if (knownEntry?.source?.url !== `file://${ROOT}`) {
    fail('known_marketplaces.json: cc-nexs source URL must remain file:// repo root');
  }
  if (knownEntry?.installLocation !== link) {
    fail('known_marketplaces.json: cc-nexs installLocation must remain marketplace symlink');
  }

  const settings = readJson(join(tmpHome, '.claude', 'settings.json'));
  for (const key of ['cc-nexs@cc-nexs', 'cc-nexs-minimal@cc-nexs']) {
    if (settings.enabledPlugins?.[key] !== true) {
      fail(`settings.json: enabledPlugins.${key} must be true`);
    }
  }
}

try {
  // install-local only writes settings.json when the file already exists.
  const settingsPath = join(tmpHome, '.claude', 'settings.json');
  mkdirSync(join(tmpHome, '.claude'), { recursive: true });
  writeFileSync(settingsPath, '{}\n', 'utf-8');

  runInstall('preset-nexs');
  runInstall('preset-minimal');
  validateInstalledPlugin('cc-nexs');
  validateInstalledPlugin('cc-nexs-minimal');
  validateMarketplaceAndSettings();

  if (errors.length > 0) {
    console.error('Claude Code install smoke failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log('Claude Code install smoke passed: isolated HOME install shape unchanged');
  }
} finally {
  rmSync(tmpHome, { recursive: true, force: true });
}
