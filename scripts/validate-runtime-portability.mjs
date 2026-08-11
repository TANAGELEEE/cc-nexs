#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const errors = [];
const checkedRoots = [join(root, 'packages/core'), join(root, 'packages/preset-standard'), join(root, 'pi')];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && /\.(?:md|mjs|json|ya?ml)$/.test(entry.name)) {
      const text = readFileSync(file, 'utf8');
      if (/\bmodel\s*:\s*(?!inherit\b)(?:gpt|claude|o\d)[a-zA-Z0-9._-]*/i.test(text)) errors.push(`${file}: fixed model field`);
      if (/(?:--model|-m)\s+(?:gpt|claude|o\d)[a-zA-Z0-9._-]*/i.test(text)) errors.push(`${file}: fixed model argument`);
    }
  }
}
for (const dir of checkedRoots) walk(dir);

const preset = readFileSync(join(root, 'packages/preset-standard/preset.yml'), 'utf8');
for (const marker of ['runtimes:', 'claude:', 'codex:', 'pi:', 'models:', 'routing:', 'escalated:', 'lean-high-risk', 'hotfix-p0-p1', 'default_mode: lean', 'model_profile: review', 'model_policy: inherit', 'force_native_agents: true', 'force_pi_subagents: true']) {
  if (!preset.includes(marker)) errors.push(`preset-standard/preset.yml: missing ${marker}`);
}

const piSkill = readFileSync(join(root, 'pi/skills/cc-nexs-run/SKILL.md'), 'utf8');
for (const marker of ['lean (default)', 'pi-subagents@0.35.1', 'subagent({', 'tasks: [', 'async: true', 'worktree: false', 'context: "fresh"', 'subagent_wait({ id:', 'same model with higher thinking', 'automatic risk routing', 'Lean high/critical', 'Hotfix P0/P1', 'explicit feature role profile remains final', 'ship no provider-specific model IDs']) {
  if (!piSkill.includes(marker)) errors.push(`Pi run skill: missing ${marker}`);
}
if (/run_in_background|background Agent calls?/i.test(piSkill)) errors.push('Pi run skill: obsolete background Agent API');

const codexSkill = readFileSync(join(root, 'dist/preset-standard/codex-skills/cc-nexs-run/SKILL.md'), 'utf8');
for (const marker of ['independent native subagent', 'Never invoke Claude Code', 'same model with higher reasoning effort', 'automatic risk routing', 'Lean high/critical', 'Hotfix P0/P1', 'explicit feature role profile remains final', 'Provider-specific IDs are allowed only in private project/feature config']) {
  if (!codexSkill.includes(marker)) errors.push(`Codex run skill: missing ${marker}`);
}

const { loadConfig } = await import(pathToFileURL(join(root, 'packages/core/lib/config-loader.mjs')).href);
const loaded = loadConfig({ projectRoot: root, presetRoot: join(root, 'packages/preset-standard') });
for (const [profile, runtimeMap] of Object.entries(loaded.preset.models?.profiles || {})) {
  for (const runtime of ['claude', 'codex', 'pi']) {
    const selection = runtimeMap[runtime] || {};
    if (selection.model !== 'inherit') errors.push(`preset profile ${profile}/${runtime}: public model must inherit`);
    if ((selection.fallback_models || selection.fallbackModels || []).length) {
      errors.push(`preset profile ${profile}/${runtime}: public fallback models must be empty`);
    }
  }
}

if (errors.length) {
  console.error('Runtime portability validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('Runtime portability passed: Claude-native Lean, Codex native-only, Pi subagent task fanout, portable profiles, and private per-role overrides.');
