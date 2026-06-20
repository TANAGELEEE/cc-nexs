#!/usr/bin/env node
// Validate the load-bearing SOP parity contract shared by Claude Code and Codex.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SRC_NEXS = join(ROOT, 'packages', 'preset-nexs');
const DIST_NEXS = join(ROOT, 'dist', 'preset-nexs');

const errors = [];

function fail(message) {
  errors.push(message);
}

function read(path) {
  if (!existsSync(path)) {
    fail(`${path}: missing`);
    return '';
  }
  return readFileSync(path, 'utf-8');
}

function mustContain(path, text, patterns) {
  for (const pattern of patterns) {
    const ok = pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
    if (!ok) fail(`${path}: missing required SOP marker ${pattern.toString()}`);
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

function validatePresetModes() {
  const path = join(SRC_NEXS, 'preset.yml');
  const text = read(path);
  mustContain(path, text, [
    'modes:',
    'full:',
    'fast:',
    'state_machine: full',
    'state_machine: fast',
    '- repo-scout',
    '- planner',
    '- tech-lead',
    '- sa',
    '- qa',
    '- evaluator',
    '- fullstack',
    '- reviewer',
    '- verifier',
    'review_revision: 2',
    'fix_per_bug: 2',
    'evaluator_reject: 2',
    'doc_dir: "all-docs/doc/{id}.{slug}/"',
    'doc_repo: "all-docs/"',
    'bugs_dir: "bugs/"',
  ]);
}

function validateInitCommand() {
  const path = join(SRC_NEXS, 'commands', 'init.md');
  const text = read(path);
  mustContain(path, text, [
    '--mode=full|fast',
    '--no-worktree',
    'all-docs/doc/${ID}.${SLUG}',
    '.worktrees/<id>-<slug>/',
    'cp -r "${CC_NEXS_RESOLVED_PLUGIN_ROOT}/templates/"* "${REQ_DIR}/"',
    '"mode"',
    'requirements.md',
    'progress.md',
    'config.json',
    'bugs/BUG-template.md',
  ]);
}

function validateRunCommand() {
  const path = join(ROOT, 'packages', 'core', 'commands', 'run.md');
  const text = read(path);
  mustContain(path, text, [
    'SPEC_PENDING_HUMAN',
    'DEPLOY_GATE',
    'MODE=$(grep -oE',
    'full|fast|lite|hotfix',
    'Role → command dispatch table',
    '/cc-nexs:recon',
    '/cc-nexs:planner',
    '/cc-nexs:dev <id> --mode=feat --sprint=N',
    '/cc-nexs:qa cases',
    '/cc-nexs:evaluator',
    '/cc-nexs:fullstack <id> --phase=spec',
    '/cc-nexs:review accept <id>',
    '/cc-nexs:verify regression <id>',
    'fast 模式解析',
    'Artifact completeness gate',
    'deploy.md api-doc.md test-report.md',
    'all-docs/doc/<id>.<slug>',
    'git add "doc/<id>.<slug>/"',
    'docs: <id> hotfix BUG-<N> 修复记录',
    'syncFeatureReadme',
  ]);
}

function validateHotfixCommand() {
  const path = join(SRC_NEXS, 'commands', 'hotfix.md');
  const text = read(path);
  mustContain(path, text, [
    'P0',
    'P1',
    'P2',
    'P3',
    'BUG-<N>.md',
    '${REQ_DIR}bugs/BUG-<N>.md',
    '${REQ_DIR}qa-scripts/BUG-<N>-repro.*',
    'SA 轻量评审',
    'append 到 ${REQ_DIR}bugs/BUG-<N>.md',
    'Evaluator 局部打分',
    '${REQ_DIR}acceptance.md',
    '${REQ_DIR}test-cases.md',
    '${REQ_DIR}deploy.md',
    '超出 hotfix 边界',
    'diff > 500 行',
    '同一 BUG 修超过 3 轮 SA NEEDS_REVISION',
    'git -C "$DOC_REPO" add "doc/<原需求编号>/"',
    'docs: <id> hotfix BUG-<N> 修复记录',
  ]);
}

function validateMirrorSkill(commandName, commandFile) {
  const skillPath = join(DIST_NEXS, 'codex-skills', commandName, 'SKILL.md');
  const text = read(skillPath);
  mustContain(skillPath, text, [
    `../../commands/${commandFile}`,
    'single source of truth',
    'Document Write Map',
    'Full / Fast / Hotfix Mode Locks',
    'all-docs/doc/{id}.{slug}/',
    'bugs/BUG-*.md',
    'qa-scripts/',
    'docs/solutions/',
    'progress.md',
    'full',
    'fast',
    'hotfix',
  ]);
}

function validateAllGeneratedMirrors() {
  const commandsRoot = join(DIST_NEXS, 'commands');
  const codexSkillsRoot = join(DIST_NEXS, 'codex-skills');
  if (!existsSync(commandsRoot)) {
    fail(`${commandsRoot}: missing`);
    return;
  }
  for (const fileName of readdirSync(commandsRoot).filter((entry) => entry.endsWith('.md')).sort()) {
    const commandText = read(join(commandsRoot, fileName));
    const commandName = extractCommandName(commandText, fileName);
    const skillName = normalizeSkillName(commandName);
    const skillPath = join(codexSkillsRoot, skillName, 'SKILL.md');
    const text = read(skillPath);
    mustContain(skillPath, text, [
      `../../commands/${fileName}`,
      'single source of truth',
      'Document Write Map',
      'Full / Fast / Hotfix Mode Locks',
      'all-docs/doc/{id}.{slug}/',
      'bugs/BUG-*.md',
      'qa-scripts/',
      'docs/solutions/',
      'progress.md',
    ]);
  }
}

validatePresetModes();
validateInitCommand();
validateRunCommand();
validateHotfixCommand();
validateMirrorSkill('cc-nexs-init', 'init.md');
validateMirrorSkill('cc-nexs-run', 'run.md');
validateMirrorSkill('cc-nexs-hotfix', 'hotfix.md');
validateAllGeneratedMirrors();

if (errors.length > 0) {
  console.error('SOP parity validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('SOP parity validation passed: full, fast, hotfix, document paths, Codex mirrors');
