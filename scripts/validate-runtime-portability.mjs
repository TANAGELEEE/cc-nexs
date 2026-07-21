#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
for (const marker of ['runtimes:', 'claude:', 'codex:', 'pi:', 'model_policy: inherit', 'force_native_agents: true', 'force_pi_subagents: true']) {
  if (!preset.includes(marker)) errors.push(`preset-standard/preset.yml: missing ${marker}`);
}

const piSkill = readFileSync(join(root, 'pi/skills/cc-nexs-run/SKILL.md'), 'utf8');
for (const marker of ['fast mode', 'pi-subagents', 'different from the implementation model', 'ships no fixed model IDs']) {
  if (!piSkill.includes(marker)) errors.push(`Pi run skill: missing ${marker}`);
}

const codexSkill = readFileSync(join(root, 'dist/preset-standard/codex-skills/cc-nexs-run/SKILL.md'), 'utf8');
for (const marker of ['independent native subagent', 'Never invoke Claude Code', 'Never pass a literal model id']) {
  if (!codexSkill.includes(marker)) errors.push(`Codex run skill: missing ${marker}`);
}

if (errors.length) {
  console.error('Runtime portability validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('Runtime portability passed: Claude hybrid, Codex native-only, Pi subagents with external model overrides.');
