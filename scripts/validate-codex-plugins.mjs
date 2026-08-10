#!/usr/bin/env node
// Validate generated Codex plugin artifacts without external dependencies.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const DIST = join(ROOT, 'dist');

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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

function validateManifest(pluginRoot) {
  const manifestPath = join(pluginRoot, '.codex-plugin', 'plugin.json');
  if (!existsSync(manifestPath)) {
    fail(`${pluginRoot}: missing .codex-plugin/plugin.json`);
    return null;
  }
  const manifest = readJson(manifestPath);
  if (!manifest) return null;

  for (const field of ['name', 'version', 'description', 'skills']) {
    if (typeof manifest[field] !== 'string' || !manifest[field].trim()) {
      fail(`${manifestPath}: ${field} must be a non-empty string`);
    }
  }
  if (typeof manifest.version === 'string' && !SEMVER_RE.test(manifest.version)) {
    fail(`${manifestPath}: version must be strict semver`);
  }
  if (manifest.skills !== './codex-skills/') {
    fail(`${manifestPath}: skills must be "./codex-skills/" so Claude Code skills/ remains unchanged`);
  }

  const iface = manifest.interface;
  if (!iface || typeof iface !== 'object' || Array.isArray(iface)) {
    fail(`${manifestPath}: interface object is required`);
    return manifest;
  }
  for (const field of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category']) {
    if (typeof iface[field] !== 'string' || !iface[field].trim()) {
      fail(`${manifestPath}: interface.${field} must be a non-empty string`);
    }
  }
  if (!Array.isArray(iface.capabilities) || iface.capabilities.some((value) => typeof value !== 'string' || !value.trim())) {
    fail(`${manifestPath}: interface.capabilities must be an array of strings`);
  }
  if (!Array.isArray(iface.defaultPrompt) || iface.defaultPrompt.length === 0 || iface.defaultPrompt.length > 3) {
    fail(`${manifestPath}: interface.defaultPrompt must contain 1-3 prompts`);
  } else {
    iface.defaultPrompt.forEach((prompt, index) => {
      if (typeof prompt !== 'string' || !prompt.trim()) {
        fail(`${manifestPath}: interface.defaultPrompt[${index}] must be a non-empty string`);
      } else if (prompt.length > 128) {
        fail(`${manifestPath}: interface.defaultPrompt[${index}] must be at most 128 characters`);
      }
    });
  }

  return manifest;
}

function validateSkill(skillRoot) {
  const skillPath = join(skillRoot, 'SKILL.md');
  const text = readFileSync(skillPath, 'utf-8');
  if (text.includes('[TODO:')) fail(`${skillPath}: contains [TODO:] placeholder`);
  if (!text.startsWith('---\n')) {
    fail(`${skillPath}: missing YAML frontmatter`);
    return;
  }
  const end = text.indexOf('\n---', 4);
  if (end < 0) {
    fail(`${skillPath}: unclosed YAML frontmatter`);
    return;
  }
  const frontmatter = text.slice(4, end);
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!name) fail(`${skillPath}: missing frontmatter name`);
  if (!description) fail(`${skillPath}: missing frontmatter description`);
  if (description && description.length > 1024) {
    fail(`${skillPath}: description exceeds 1024 characters`);
  }
  if (/^disable-model-invocation:\s*true\s*$/m.test(frontmatter)) {
    fail(`${skillPath}: Codex explicit-only policy belongs in agents/openai.yaml`);
  }

  const agentMetadataPath = join(skillRoot, 'agents', 'openai.yaml');
  if (!existsSync(agentMetadataPath)) {
    fail(`${skillRoot}: missing agents/openai.yaml explicit-invocation policy`);
    return;
  }
  const agentMetadata = readFileSync(agentMetadataPath, 'utf-8');
  for (const field of ['interface:', '  display_name:', '  short_description:', '  default_prompt:', 'policy:']) {
    if (!agentMetadata.includes(field)) fail(`${agentMetadataPath}: missing ${field.trim()}`);
  }
  if (!/^\s{2}allow_implicit_invocation:\s*false\s*$/m.test(agentMetadata)) {
    fail(`${agentMetadataPath}: policy.allow_implicit_invocation must be false`);
  }
  if (name && !agentMetadata.includes(`$${name}`)) {
    fail(`${agentMetadataPath}: interface.default_prompt must explicitly mention $${name}`);
  }
}

function validateSkills(pluginRoot, manifest) {
  const skillsRoot = join(pluginRoot, manifest?.skills || 'codex-skills');
  if (!existsSync(skillsRoot)) {
    fail(`${pluginRoot}: missing ${manifest?.skills || './codex-skills/'}`);
    return;
  }
  for (const entry of readdirSync(skillsRoot).sort()) {
    const skillRoot = join(skillsRoot, entry);
    if (!statSync(skillRoot).isDirectory()) continue;
    const skillPath = join(skillRoot, 'SKILL.md');
    if (!existsSync(skillPath)) {
      fail(`${skillRoot}: missing SKILL.md`);
      continue;
    }
    validateSkill(skillRoot);
  }
}

function validateCommandMirrors(pluginRoot, manifest) {
  const commandsRoot = join(pluginRoot, 'commands');
  const skillsRoot = join(pluginRoot, manifest?.skills || './codex-skills/');
  if (!existsSync(commandsRoot)) return;
  for (const fileName of readdirSync(commandsRoot).filter((entry) => entry.endsWith('.md')).sort()) {
    const text = readFileSync(join(commandsRoot, fileName), 'utf-8');
    const commandName = extractCommandName(text, fileName);
    const skillName = normalizeSkillName(commandName);
    const skillPath = join(skillsRoot, skillName, 'SKILL.md');
    if (!existsSync(skillPath)) {
      fail(`${pluginRoot}: command ${commandName} is missing mirror skill ${skillName}`);
      continue;
    }
    const skillText = readFileSync(skillPath, 'utf-8');
    if (!skillText.includes(`../../commands/${fileName}`)) {
      fail(`${skillPath}: does not reference ../../commands/${fileName}`);
    }
    if (['approve-deploy.md', 'approve-spec.md', 'approve-plan.md', 'approve-release.md', 'release-test.md', 'verify-local.md', 'release-base.md', 'render-plan.md', 'migrate-feature-config.md'].includes(fileName)
      && !skillText.includes('../../lib/cc-nexs-cli.mjs')) {
      fail(`${skillPath}: control skill must invoke the deterministic CLI`);
    }
    if (fileName === 'release-test.md' && !skillText.includes('Deterministic Test Release Control')) {
      fail(`${skillPath}: release-test must include deterministic control block`);
    }
  }
}

function readSkillName(skillPath) {
  const text = readFileSync(skillPath, 'utf-8');
  const frontmatter = text.startsWith('---\n') ? text.slice(4, text.indexOf('\n---', 4)) : '';
  return frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || null;
}

function validateNoDuplicateSkillNames(pluginRoot, manifest) {
  const roots = [join(pluginRoot, 'skills'), join(pluginRoot, manifest?.skills || './codex-skills/')];
  const seen = new Map();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).sort()) {
      const skillPath = join(root, entry, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      const name = readSkillName(skillPath);
      if (!name) continue;
      if (seen.has(name)) {
        fail(`${skillPath}: duplicate skill name "${name}" also exists at ${seen.get(name)}`);
      } else {
        seen.set(name, skillPath);
      }
    }
  }
}

function validateHooks(pluginRoot) {
  const hooksPath = join(pluginRoot, 'hooks', 'hooks.json');
  if (!existsSync(hooksPath)) return;
  const text = readFileSync(hooksPath, 'utf-8');
  const config = readJson(hooksPath);
  if (!config) return;
  if (/\$\{[^}]*:-/.test(text)) {
    fail(`${hooksPath}: uses POSIX-only environment fallback syntax`);
  }
  if (text.includes('CODEX_PLUGIN_ROOT')) {
    fail(`${hooksPath}: uses undocumented CODEX_PLUGIN_ROOT instead of Codex PLUGIN_ROOT`);
  }
  const handlers = Object.values(config.hooks || {})
    .flatMap((groups) => Array.isArray(groups) ? groups : [])
    .flatMap((group) => Array.isArray(group?.hooks) ? group.hooks : []);
  for (const handler of handlers) {
    if (handler?.type !== 'command') continue;
    if (!handler.command?.includes('process.env.PLUGIN_ROOT')) {
      fail(`${hooksPath}: Codex hook command must resolve process.env.PLUGIN_ROOT`);
    }
    if (!handler.command?.includes('process.env.CLAUDE_PLUGIN_ROOT')) {
      fail(`${hooksPath}: shared hook command must retain Claude Code compatibility`);
    }
    if (/CC_NEXS_PLUGIN_ROOT\s*\|\|\s*['"]?\./.test(handler.command || '')) {
      fail(`${hooksPath}: hook command must not fall back to the session cwd`);
    }
  }
}

function validateMarketplace(presets) {
  const marketplacePath = join(ROOT, '.agents', 'plugins', 'marketplace.json');
  if (!existsSync(marketplacePath)) {
    fail(`${marketplacePath}: missing Codex marketplace`);
    return;
  }
  const marketplace = readJson(marketplacePath);
  if (!marketplace) return;
  if (marketplace.name !== 'cc-nexs') fail(`${marketplacePath}: name must be cc-nexs`);
  if (!Array.isArray(marketplace.plugins)) {
    fail(`${marketplacePath}: plugins must be an array`);
    return;
  }
  for (const presetRoot of presets) {
    const manifest = readJson(join(presetRoot, '.codex-plugin', 'plugin.json'));
    if (!manifest) continue;
    const expectedPath = `./dist/${basename(presetRoot)}`;
    const entry = marketplace.plugins.find((candidate) => candidate?.name === manifest.name);
    if (!entry) {
      fail(`${marketplacePath}: missing plugin entry ${manifest.name}`);
      continue;
    }
    if (entry.source?.source !== 'local' || entry.source?.path !== expectedPath) {
      fail(`${marketplacePath}: ${manifest.name} source must be local ${expectedPath}`);
    }
    if (entry.policy?.installation !== 'AVAILABLE' || entry.policy?.authentication !== 'ON_INSTALL') {
      fail(`${marketplacePath}: ${manifest.name} must use AVAILABLE / ON_INSTALL policy`);
    }
  }
}

const presets = listPresetDirs();
if (presets.length === 0) fail(`${DIST}: no preset-* directories found; run pnpm build first`);

for (const presetRoot of presets) {
  const manifest = validateManifest(presetRoot);
  validateSkills(presetRoot, manifest);
  validateCommandMirrors(presetRoot, manifest);
  validateNoDuplicateSkillNames(presetRoot, manifest);
  validateHooks(presetRoot);
}
validateMarketplace(presets);

if (errors.length > 0) {
  console.error('Codex plugin validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Codex plugin validation passed: ${presets.map((path) => basename(path)).join(', ')}`);
