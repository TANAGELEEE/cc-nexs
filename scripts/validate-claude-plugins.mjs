#!/usr/bin/env node
// Validate that Codex support has not changed the Claude Code plugin install surface.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const DIST = join(ROOT, 'dist');
const MARKETPLACE = join(ROOT, '.claude-plugin', 'marketplace.json');
const PACKAGE_JSON = join(ROOT, 'package.json');

const errors = [];

function fail(message) {
  errors.push(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    fail(`${path}: invalid JSON (${error.message})`);
    return null;
  }
}

function normalizeSkillName(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function extractCommandName(commandText, commandFile) {
  const h1 = commandText.match(/^#\s+(\/[^\s]+)/m);
  if (h1) return h1[1].trim();
  return `/cc-nexs:${basename(commandFile, extname(commandFile))}`;
}

function listPresetDirs() {
  if (!existsSync(DIST)) return [];
  return readdirSync(DIST)
    .filter((entry) => entry.startsWith('preset-'))
    .map((entry) => join(DIST, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .sort();
}

function validatePackageScripts() {
  const pkg = readJson(PACKAGE_JSON);
  if (!pkg) return;
  if (pkg.scripts?.['install:local'] !== 'node scripts/install-local.mjs') {
    fail(`${PACKAGE_JSON}: install:local must keep using scripts/install-local.mjs`);
  }
  if (pkg.scripts?.['install:local:minimal'] !== 'node scripts/install-local.mjs preset-minimal') {
    fail(`${PACKAGE_JSON}: install:local:minimal must keep using scripts/install-local.mjs preset-minimal`);
  }
}

function validateClaudeMarketplace(presets) {
  if (!existsSync(MARKETPLACE)) {
    fail(`${MARKETPLACE}: missing Claude Code marketplace`);
    return;
  }
  const marketplace = readJson(MARKETPLACE);
  if (!marketplace) return;
  if (marketplace.name !== 'cc-nexs') fail(`${MARKETPLACE}: name must remain cc-nexs`);
  if (!Array.isArray(marketplace.plugins)) {
    fail(`${MARKETPLACE}: plugins must be an array`);
    return;
  }

  for (const presetRoot of presets) {
    const manifestPath = join(presetRoot, '.claude-plugin', 'plugin.json');
    if (!existsSync(manifestPath)) {
      fail(`${presetRoot}: missing .claude-plugin/plugin.json`);
      continue;
    }
    const manifest = readJson(manifestPath);
    if (!manifest) continue;
    const expectedSource = `./dist/${basename(presetRoot)}`;
    const entry = marketplace.plugins.find((candidate) => candidate?.name === manifest.name);
    if (!entry) {
      fail(`${MARKETPLACE}: missing Claude plugin entry ${manifest.name}`);
      continue;
    }
    if (entry.source !== expectedSource) {
      fail(`${MARKETPLACE}: ${manifest.name} source must remain ${expectedSource}`);
    }
    if (entry.source?.includes('.agents') || entry.source?.includes('codex')) {
      fail(`${MARKETPLACE}: ${manifest.name} source must not point at Codex-only artifacts`);
    }
  }
}

function validateClaudeSkillsAreUnchanged(pluginRoot) {
  const commandsRoot = join(pluginRoot, 'commands');
  const skillsRoot = join(pluginRoot, 'skills');
  const codexSkillsRoot = join(pluginRoot, 'codex-skills');
  if (!existsSync(commandsRoot) || !existsSync(skillsRoot)) return;

  for (const fileName of readdirSync(commandsRoot).filter((entry) => entry.endsWith('.md')).sort()) {
    const commandText = readFileSync(join(commandsRoot, fileName), 'utf-8');
    const skillName = normalizeSkillName(extractCommandName(commandText, fileName));
    const claudeMirrorPath = join(skillsRoot, skillName, 'SKILL.md');
    if (existsSync(claudeMirrorPath)) {
      fail(`${claudeMirrorPath}: Codex command mirror leaked into Claude Code skills/`);
    }
    const codexMirrorPath = join(codexSkillsRoot, skillName, 'SKILL.md');
    if (!existsSync(codexMirrorPath)) {
      fail(`${codexMirrorPath}: Codex command mirror missing from codex-skills/`);
    }
  }
}

const presets = listPresetDirs();
if (presets.length === 0) fail(`${DIST}: no preset-* directories found; run pnpm build first`);

validatePackageScripts();
validateClaudeMarketplace(presets);
for (const presetRoot of presets) validateClaudeSkillsAreUnchanged(presetRoot);

if (errors.length > 0) {
  console.error('Claude Code plugin validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Claude Code plugin validation passed: ${presets.map((path) => basename(path)).join(', ')}`);
